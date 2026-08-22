import { describe, expect, it } from "vitest";

import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  GitRepository,
  GitState,
  ImplementationTask,
  TaskCompletionResult,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSource,
  Verifier,
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
  instructions: "Finish the task.",
  title: "Finish the task",
};

const before: GitState = {
  dirtyPaths: [],
  head: "before",
  root: "/repo",
  trackedPatch: "",
  untrackedHashes: {},
};

class RestartGit implements GitRepository {
  readonly #states = [before, { ...before, head: "after" }];

  commitsBetween(): Promise<readonly string[]> {
    return Promise.resolve(["after"]);
  }

  inspect(): Promise<GitState> {
    const state = this.#states.shift();
    if (state === undefined) throw new Error("Missing Git state");
    return Promise.resolve(state);
  }

  resolvePrivatePath(): Promise<string> {
    return Promise.resolve("/repo/.git/striker");
  }

  resolveRoot(): Promise<string> {
    return Promise.resolve("/repo");
  }
}

class RestartSource implements TaskSource {
  completionEvidence(
    _task: ImplementationTask,
    execution?: TaskExecutionEvidence,
  ): Promise<TaskCompletionResult> {
    return Promise.resolve(
      execution === undefined
        ? {
            attention: {
              detail: "Execution evidence is missing.",
              reason: "completion_evidence_missing",
            },
            status: "needs_attention",
          }
        : { evidence: { summary: "complete" }, status: "completed" },
    );
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

const verifier: Verifier = {
  verify: ({ command }) =>
    Promise.resolve({ command, exitCode: 0, output: "ok" }),
};

describe("Dispatcher baseline restart", () => {
  it("captures a missing baseline before retrying attempt one", async () => {
    const request = {
      completedTasks: [],
      planId: "plan-baseline-recovery",
      runId: "run-baseline-recovery",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    const journal = new InMemoryRunJournal();
    await journal.append({
      planId: request.planId,
      request,
      runId: request.runId,
      type: "run_started",
    });
    await journal.append({ runId: request.runId, task, type: "task_selected" });
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource()),
      type: "memory",
    });
    const dispatcher = new Dispatcher({
      adapters,
      git: new RestartGit(),
      journal,
      runner: new FakeAgentRunner({
        output: "done",
        session: { id: "restarted-session" },
        status: "returned",
      }),
      verifier,
    });

    await expect(dispatcher.resume()).resolves.toMatchObject({
      reason: "session_resume_failed",
    });
    await expect(dispatcher.retry()).resolves.toMatchObject({
      status: "completed",
    });
    const baselineIndex = journal.events.findIndex(
      (event) => event.type === "task_baseline_recorded",
    );
    const attemptIndex = journal.events.findIndex(
      (event) => event.type === "task_attempt_started",
    );
    expect(baselineIndex).toBeGreaterThan(-1);
    expect(baselineIndex).toBeLessThan(attemptIndex);
    expect(journal.events[baselineIndex]).toMatchObject({ before });
  });
});
