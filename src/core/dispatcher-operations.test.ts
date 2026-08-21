import { describe, expect, it } from "vitest";

import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  ImplementationTask,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task: ImplementationTask = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build the command.",
  title: "Build the command",
};
const request = {
  completedTasks: [],
  runId: "run-recovery",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
} as const;

class CompletingSource implements TaskSource {
  marked = false;

  completionEvidence(): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: { summary: "task complete" },
      status: "completed",
    });
  }

  markCompleted(): Promise<void> {
    this.marked = true;
    return Promise.resolve();
  }

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    return Promise.resolve(completed.length === 0 ? task : null);
  }

  reconcileCompleted(): Promise<null> {
    return Promise.resolve(null);
  }
}

function fixture(runner: AgentRunner) {
  const source = new CompletingSource();
  const adapters = new AdapterRegistry();
  adapters.register({ open: () => Promise.resolve(source), type: "memory" });
  const journal = new InMemoryRunJournal();
  return {
    dispatcher: new Dispatcher({ adapters, journal, runner }),
    journal,
    source,
  };
}

async function seedAttempt(
  journal: InMemoryRunJournal,
  status: "failed" | "needs_attention" | "running",
) {
  const session = { id: "runtime-old", resumeId: "provider-old" };
  await journal.append({ runId: request.runId, type: "run_started" });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  if (status === "needs_attention") {
    await journal.append({
      attention: { detail: "Needs repair.", reason: "verification_failed" },
      runId: request.runId,
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
  }
  if (status === "failed") {
    await journal.append({
      error: "Agent turn failed.",
      runId: request.runId,
      session,
      task: task.identity,
      type: "run_failed",
    });
  }
  await journal.replace({
    attempt: 1,
    attention:
      status === "needs_attention"
        ? { detail: "Needs repair.", reason: "verification_failed" }
        : null,
    before: null,
    request,
    runId: request.runId,
    session,
    status,
    task,
  });
}

async function expectFreshRetry(
  status: "failed" | "needs_attention",
): Promise<void> {
  const runner = new FakeAgentRunner({
    output: "done",
    session: { id: "runtime-new", resumeId: "provider-new" },
    status: "returned",
  });
  const test = fixture(runner);
  await seedAttempt(test.journal, status);

  await expect(test.dispatcher.retry()).resolves.toMatchObject({
    status: "completed",
  });

  expect(runner.requests).toHaveLength(1);
  expect(runner.resumeRequests).toHaveLength(0);
  expect(test.journal.events).toContainEqual({
    attempt: 1,
    runId: request.runId,
    task: task.identity,
    type: "run_retried",
  });
  expect(test.journal.events).toContainEqual({
    attempt: 2,
    runId: request.runId,
    session: { id: "runtime-new", resumeId: "provider-new" },
    task: task.identity,
    type: "task_session_started",
  });
}

describe("Dispatcher interrupted-attempt recovery", () => {
  it("persists a new session before its turn completes", async () => {
    const session = { id: "runtime-new", resumeId: "provider-new" };
    const observed: { snapshot?: unknown } = {};
    const runner: AgentRunner = {
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Unexpected resume");
      },
      runInNewSession: async (_request, sessionStarted) => {
        await sessionStarted?.(session);
        observed.snapshot = test.journal.snapshots.at(-1);
        return { output: "done", session, status: "returned" };
      },
    };
    const test = fixture(runner);

    await test.dispatcher.dispatchOne(request);

    expect(observed.snapshot).toMatchObject({
      attempt: 1,
      session,
      status: "running",
    });
    expect(test.journal.events).toContainEqual({
      attempt: 1,
      runId: request.runId,
      session,
      task: task.identity,
      type: "task_session_started",
    });
  });

  it("resumes an interrupted running attempt in its recorded session", async () => {
    const runner = new FakeAgentRunner({
      output: "done",
      session: { id: "runtime-old", resumeId: "provider-old" },
      status: "returned",
    });
    const test = fixture(runner);
    await seedAttempt(test.journal, "running");

    await expect(test.dispatcher.resume()).resolves.toMatchObject({
      status: "completed",
    });
    expect(runner.resumeRequests[0]?.instructions).toContain(
      "interrupted task",
    );
    expect(test.source.marked).toBe(true);
  });

  it("pauses with a retry choice when an interrupted session cannot load", async () => {
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeSession: () => Promise.reject(new Error("provider session lost")),
      runInNewSession: () => {
        throw new Error("Unexpected fresh session");
      },
    });
    await seedAttempt(test.journal, "running");

    await expect(test.dispatcher.resume()).resolves.toMatchObject({
      reason: "session_resume_failed",
      status: "needs_attention",
    });
    expect(test.journal.snapshots.at(-1)?.attention?.detail).toContain(
      "striker retry",
    );
  });
});

describe("Dispatcher sessionless pause recovery", () => {
  it("does not append another transition for a sessionless pause", async () => {
    const test = fixture(
      new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
    );
    const attention = {
      detail: "Run `striker retry`.",
      reason: "session_resume_failed" as const,
    };
    await test.journal.append({
      runId: request.runId,
      type: "run_started",
    });
    await test.journal.append({
      attention,
      runId: request.runId,
      session: null,
      task: task.identity,
      type: "run_needs_attention",
    });
    await test.journal.replace({
      attempt: 1,
      attention,
      request,
      runId: request.runId,
      session: null,
      status: "needs_attention",
      task,
    });
    const eventCount = test.journal.events.length;

    await expect(test.dispatcher.resume()).resolves.toMatchObject({
      reason: "session_resume_failed",
      session: null,
      status: "needs_attention",
    });
    expect(test.journal.events).toHaveLength(eventCount);
  });
});

describe("Dispatcher retry", () => {
  it.each(["failed", "needs_attention"] as const)(
    "retries a %s attempt in a fresh session",
    expectFreshRetry,
  );

  it("increments the durable attempt after a failed retry", async () => {
    const runner = new FakeAgentRunner([
      {
        error: "retry failed",
        session: { id: "runtime-second", resumeId: "provider-second" },
        status: "failed",
      },
      {
        output: "done",
        session: { id: "runtime-third", resumeId: "provider-third" },
        status: "returned",
      },
    ]);
    const test = fixture(runner);
    await seedAttempt(test.journal, "failed");

    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      status: "failed",
    });
    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attempt: 2,
      status: "failed",
    });
    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      status: "completed",
    });

    expect(
      test.journal.events
        .filter((event) => event.type === "run_retried")
        .map((event) => event.attempt),
    ).toEqual([1, 2]);
  });

  it("never retries a task already recorded as completed", async () => {
    const test = fixture(
      new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
    );
    await seedAttempt(test.journal, "failed");
    await test.journal.append({
      runId: request.runId,
      session: { id: "runtime-old", resumeId: "provider-old" },
      task: task.identity,
      type: "task_completed",
    });

    await expect(test.dispatcher.retry()).rejects.toThrow(
      "Cannot retry a completed Striker task",
    );
  });
});

describe("Dispatcher recovery status", () => {
  it("reports durable status and discards only paused or failed state", async () => {
    const test = fixture(
      new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
    );
    await seedAttempt(test.journal, "needs_attention");

    await expect(test.dispatcher.status()).resolves.toEqual({
      attempt: 1,
      attentionReason: "verification_failed",
      lastTransition: "run_needs_attention",
      runId: request.runId,
      session: { id: "runtime-old", resumeId: "provider-old" },
      status: "needs_attention",
      task: task.identity,
    });
    await expect(test.dispatcher.discard()).resolves.toBeUndefined();
    expect(test.journal.deletedRunIds).toEqual([request.runId]);
  });

  it("reports a completed-task conflict as the attention reason", async () => {
    const test = fixture(
      new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
    );
    await test.journal.append({
      runId: request.runId,
      type: "run_started",
    });
    await test.journal.append({
      current: { id: task.identity.id, revision: "changed" },
      runId: request.runId,
      task: task.identity,
      type: "run_source_changed",
    });
    await test.journal.replace({
      runId: request.runId,
      session: null,
      status: "needs_attention",
      task: null,
    });

    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attentionReason: "completed_task_changed",
      lastTransition: "run_source_changed",
    });
  });
});

describe("Dispatcher recovery discard", () => {
  it("refuses to discard a running attempt", async () => {
    const test = fixture(
      new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
    );
    await seedAttempt(test.journal, "running");

    await expect(test.dispatcher.discard()).rejects.toThrow(
      "Only paused or failed Striker runs can be discarded",
    );
    expect(test.journal.deletedRunIds).toEqual([]);
  });
});
