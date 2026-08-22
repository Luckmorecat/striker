import { describe, expect, it } from "vitest";

import {
  InMemoryRunJournal,
  runPassingStandardsReview,
} from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  GitRepository,
  GitState,
  ImplementationTask,
  TaskCompletionResult,
  TaskIdentity,
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

function fixture(runner: AgentRunner) {
  const adapters = new AdapterRegistry();
  adapters.register({
    open: () => Promise.resolve(new CompletingSource()),
    type: "memory",
  });
  const journal = new InMemoryRunJournal();
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

  it("preserves a session when the turn throws after its callback", async () => {
    const session = { id: "runtime-new", resumeId: "provider-new" };
    const test = fixture({
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Unexpected resume");
      },
      runReviewInNewSession: runPassingStandardsReview,
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
      runReviewInNewSession: runPassingStandardsReview,
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
      runId: request.runId,
      session,
      task: task.identity,
      type: "task_session_started",
    });
  });
});
