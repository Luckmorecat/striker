import { describe, expect, it } from "vitest";

import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
  runPassingReview,
} from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  GitRepository,
  GitState,
  ImplementationTask,
  TaskCompletionResult,
  TaskIdentity,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task: ImplementationTask = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "Implement the task.",
  },
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build the command.",
  title: "Build the command",
};

const repositoryState: GitState = {
  dirtyPaths: [],
  head: "after",
  root: "/repo",
  trackedPatch: "",
  untrackedHashes: {},
};

const git: GitRepository = {
  changedPaths: () => Promise.resolve(["src/task.ts"]),
  commitsBetween: () => Promise.resolve(["after"]),
  inspect: () => Promise.resolve(repositoryState),
  resolvePrivatePath: () => Promise.resolve("/repo/.git/striker"),
  resolveRoot: () => Promise.resolve("/repo"),
};
const request = {
  completedTasks: [],
  planId: "run-initialization",
  runId: "run-initialization",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
} as const;
const preparedRequest = {
  instructions: task.instructions,
  skills: request.skills,
  workflowInstructions: "Implement the task.",
} as const;

class CompletingSource implements TaskSource {
  completionEvidence(): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: { summary: "task complete" },
      status: "completed",
    });
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

function fixture(
  runner: AgentRunner,
  journal: InMemoryRunJournal = new InMemoryRunJournal(),
) {
  const adapters = new AdapterRegistry();
  adapters.register({
    open: () => Promise.resolve(new CompletingSource()),
    type: "memory",
  });
  return {
    dispatcher: new Dispatcher({
      adapters,
      git,
      journal,
      runner,
      verifier: {
        verify: ({ command }) =>
          Promise.resolve({ command, exitCode: 0, output: "ok" }),
      },
    }),
    journal,
  };
}

async function seedFailedAttempt(journal: InMemoryRunJournal): Promise<void> {
  const session = { id: "runtime-old", resumeId: "provider-old" };
  await journal.append({
    planId: request.runId,
    request: { ...request, planId: request.runId },
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: repositoryState,
    runId: request.runId,
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: preparedRequest,
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  await journal.append({
    error: "Agent turn failed.",
    runId: request.runId,
    session,
    task: task.identity,
    type: "run_failed",
  });
}

describe("Dispatcher pre-durable session initialization", () => {
  it("pauses when session recording fails before becoming durable", async () => {
    class RejectingSessionJournal extends InMemoryRunJournal {
      override append(event: RunJournalEvent): Promise<void> {
        if (event.type === "task_session_started") {
          return Promise.reject(new Error("journal write failed"));
        }
        return super.append(event);
      }
    }
    const journal = new RejectingSessionJournal();
    const session = { id: "runtime-new", resumeId: "provider-new" };
    const test = fixture(
      {
        preflight: () => Promise.resolve(),
        resumeSession: () => {
          throw new Error("Unexpected resume");
        },
        runInNewSession: async (_request, sessionStarted) => {
          await sessionStarted?.(session);
          return { output: "unreachable", session, status: "returned" };
        },
      },
      journal,
    );

    await expect(test.dispatcher.dispatchOne(request)).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
      session: null,
      status: "needs_attention",
    });
    expect(journal.events).not.toContainEqual(
      expect.objectContaining({ type: "task_session_started" }),
    );
  });
});

describe("Dispatcher session initialization", () => {
  it("pauses a first attempt when initialization is interrupted", async () => {
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Unexpected resume");
      },
      runInNewSession: () =>
        Promise.reject(new Error("could not persist session options")),
    });

    await expect(test.dispatcher.dispatchOne(request)).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
      session: null,
      status: "needs_attention",
      task,
    });
    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attempt: 1,
      attentionReason: "run_initialization_interrupted",
      session: null,
      status: "needs_attention",
      task: task.identity,
    });
    expect(test.journal.snapshots.at(-1)).toMatchObject({
      attempt: 1,
      attention: {
        detail:
          "Could not initialize a durable task session: could not persist session options. Run `striker retry` to start a fresh attempt.",
        reason: "run_initialization_interrupted",
      },
      request,
      session: null,
      status: "needs_attention",
      task,
    });
  });
});

describe("Dispatcher durable session initialization", () => {
  it("redelivers an uncertain first turn at least once in the same session", async () => {
    const session = { id: "runtime-new", resumeId: "provider-new" };
    const resumed: unknown[] = [];
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeInitialSession: (recoveredSession, recovery) => {
        resumed.push({ recovery, session: recoveredSession });
        if (resumed.length === 1) {
          return Promise.reject(new Error("redelivery transport failed"));
        }
        return Promise.resolve({ output: "done", session, status: "returned" });
      },
      resumeSession: () => {
        throw new Error("Unexpected ordinary resume");
      },
      runReviewInNewSession: runPassingReview,
      runInNewSession: async (_request, sessionStarted) => {
        await sessionStarted?.(session);
        throw new Error("turn transport failed");
      },
    });

    await expect(test.dispatcher.dispatchOne(request)).rejects.toThrow(
      "turn transport failed",
    );
    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attempt: 1,
      session,
      status: "running",
      task: task.identity,
    });
    expect(test.journal.events).not.toContainEqual(
      expect.objectContaining({ type: "run_needs_attention" }),
    );

    await expect(test.dispatcher.resume()).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
      session,
      status: "needs_attention",
    });
    await expect(test.dispatcher.resume()).resolves.toMatchObject({
      status: "completed",
    });
    expect(resumed).toEqual(
      Array.from({ length: 2 }, () => ({
        recovery: {
          kind: "uncertain_initial_delivery",
          request: preparedRequest,
        },
        session,
      })),
    );
  });
});

describe("Dispatcher retry initialization", () => {
  it("pauses a retry when initialization is interrupted", async () => {
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Unexpected resume");
      },
      runInNewSession: () =>
        Promise.reject(new Error("could not persist retry session")),
    });
    await seedFailedAttempt(test.journal);

    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
      session: null,
      status: "needs_attention",
    });
    expect(test.journal.snapshots.at(-1)).toMatchObject({
      attempt: 2,
      attention: {
        detail:
          "Could not initialize a durable task session: could not persist retry session. Run `striker retry` to start a fresh attempt.",
        reason: "run_initialization_interrupted",
      },
      request,
      session: null,
      status: "needs_attention",
      task,
    });
  });

  it("increments every interrupted retry attempt", async () => {
    let requestCount = 0;
    const session = { id: "runtime-fourth", resumeId: "provider-fourth" };
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Unexpected resume");
      },
      runReviewInNewSession: runPassingReview,
      runInNewSession: async (_request, sessionStarted) => {
        requestCount += 1;
        if (requestCount < 3) {
          throw new Error(`interruption ${String(requestCount)}`);
        }
        await sessionStarted?.(session);
        return { output: "done", session, status: "returned" };
      },
    });
    await seedFailedAttempt(test.journal);

    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
    });
    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attempt: 2,
      status: "needs_attention",
    });
    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
    });
    await expect(test.dispatcher.status()).resolves.toMatchObject({
      attempt: 3,
      status: "needs_attention",
    });
    await expect(test.dispatcher.retry()).resolves.toMatchObject({
      status: "completed",
    });

    expect(
      test.journal.events
        .filter((event) => event.type === "run_retried")
        .map((event) => event.attempt),
    ).toEqual([1, 2, 3]);
    expect(test.journal.events).toContainEqual({
      attempt: 4,
      request: preparedRequest,
      runId: request.runId,
      session,
      task: task.identity,
      type: "task_session_started",
    });
  });
});

class OutcomeJournal implements RunJournal {
  readonly events: RunJournalEvent[] = [];

  constructor(private readonly recovery: RunRecoveryState) {}

  append(event: RunJournalEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  load(): Promise<RunRecoveryState> {
    return Promise.resolve(this.recovery);
  }

  loadActive(): Promise<null> {
    return Promise.resolve(null);
  }
}

function outcomeRecovery(): RunRecoveryState {
  const source = { id: "tasks/01.md", revision: "source-revision" };
  const routedTarget = { id: "tasks/02.md", revision: "target-revision" };
  return {
    completedTasks: [source],
    lastEvent: {
      planId: "outcome-plan",
      request: { ...request, planId: "outcome-plan", runId: "source-run" },
      runId: "source-run",
      type: "run_started",
    },
    planId: "outcome-plan",
    snapshot: null,
    taskOutcomes: [
      {
        attempt: 1,
        changedPaths: ["src/outcome.ts"],
        facts: [
          {
            category: "public_contract",
            evidence: {
              commit: "source-commit",
              kind: "code",
              line: 4,
              path: "src/outcome.ts",
              text: "export const outcome = true;",
            },
            id: "F1",
            relevantTo: [routedTarget],
            statement: "The outcome contract is stable.",
          },
        ],
        resultCommit: "source-commit",
        runId: "source-run",
        source,
        transitions: [],
        verification: { command: "pnpm check", exitCode: 0 },
      },
    ],
  };
}

function outcomeDispatcher(isAncestor: boolean) {
  const recovery = outcomeRecovery();
  const source = recovery.completedTasks[0];
  if (source === undefined) throw new Error("Missing source fixture");
  const sourceTask: ImplementationTask = {
    ...task,
    identity: source,
  };
  const routedTask: ImplementationTask = {
    ...task,
    identity: { id: "tasks/02.md", revision: "target-revision" },
    outcomePlanId: "outcome-plan",
    outcomePlanRoutes: [
      {
        from: source,
        to: [{ id: "tasks/02.md", revision: "target-revision" }],
      },
    ],
    outcomeTaskOrder: [
      source,
      { id: "tasks/02.md", revision: "target-revision" },
    ],
  };
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [sourceTask, routedTask], {
      [routedTask.identity.id]: { summary: "complete" },
    }),
  );
  const runner = new FakeAgentRunner({
    error: "stop after request capture",
    session: { id: "target-session" },
    status: "failed",
  });
  const journal = new OutcomeJournal(recovery);
  const outcomeGit: GitRepository = {
    ...git,
    inspect: () => Promise.resolve(repositoryState),
    isAncestor: () => Promise.resolve(isAncestor),
  };
  return {
    dispatcher: new Dispatcher({
      adapters,
      git: outcomeGit,
      journal,
      runner,
    }),
    journal,
    runner,
  };
}

describe("Dispatcher Task Outcome delivery", () => {
  it("persists and sends routed evidence before the target session starts", async () => {
    const test = outcomeDispatcher(true);

    await expect(
      test.dispatcher.dispatchOne({
        ...request,
        planId: "outcome-plan",
        runId: "target-run",
      }),
    ).resolves.toMatchObject({ status: "failed" });

    expect(test.runner.lastRequest?.priorTaskEvidence).toEqual([
      expect.objectContaining({
        facts: [expect.objectContaining({ id: "F1" })],
        source: { id: "tasks/01.md", revision: "source-revision" },
      }),
    ]);
    expect(
      test.journal.events.find(
        (event) => event.type === "task_session_started",
      ),
    ).toMatchObject({ request: test.runner.lastRequest });
  });

  it("stops before session creation when ancestry conflicts", async () => {
    const test = outcomeDispatcher(false);

    await expect(
      test.dispatcher.dispatchOne({
        ...request,
        planId: "outcome-plan",
        runId: "target-run",
      }),
    ).resolves.toMatchObject({
      reason: "task_outcome_conflict",
      session: null,
      status: "needs_attention",
    });
    expect(test.runner.requests).toEqual([]);
    expect(test.journal.events).not.toContainEqual(
      expect.objectContaining({ type: "task_session_started" }),
    );
  });
});
