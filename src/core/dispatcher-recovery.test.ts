import { describe, expect, it } from "vitest";

import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AttentionReason,
  GitRepository,
  GitState,
  ImplementationTask,
  TaskCompletionResult,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task: ImplementationTask = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build the command.",
  title: "Build the command",
};

class OutputBackedSource implements TaskSource {
  marked = false;

  completionEvidence(
    _task: ImplementationTask,
    _execution: undefined,
    agentOutput = "",
  ): Promise<TaskCompletionResult> {
    return Promise.resolve(
      agentOutput === "complete"
        ? {
            evidence: { summary: "task complete" },
            status: "completed",
          }
        : {
            attention: {
              detail: "The task source cannot prove completion.",
              reason: "completion_evidence_missing",
            },
            status: "needs_attention",
          },
    );
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

class CompletedSource implements TaskSource {
  marked = false;

  constructor(private readonly implementationTask: ImplementationTask) {}

  completionEvidence(
    _task: ImplementationTask,
    execution?: TaskExecutionEvidence,
  ): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: {
        summary: "task complete",
        ...(execution === undefined
          ? {}
          : { verification: execution.verification }),
      },
      status: "completed",
    });
  }

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    return Promise.resolve(
      completed.length === 0 ? this.implementationTask : null,
    );
  }

  reconcileCompleted(): Promise<null> {
    return Promise.resolve(null);
  }

  markCompleted(): Promise<void> {
    this.marked = true;
    return Promise.resolve();
  }
}

class SequenceGit implements GitRepository {
  private index = 0;

  constructor(
    private readonly states: readonly GitState[],
    private readonly commits: readonly string[] = ["after"],
  ) {}

  commitsBetween(): Promise<readonly string[]> {
    return Promise.resolve(this.commits);
  }

  inspect(): Promise<GitState> {
    const state = this.states[this.index] ?? this.states.at(-1);
    this.index += 1;
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

function gitState(head: string, trackedPatch = ""): GitState {
  return {
    dirtyPaths: trackedPatch === "" ? [] : ["src/command.ts"],
    head,
    root: "/repo",
    trackedPatch,
    untrackedHashes: {},
  };
}

function recoveryExecutionFixture(
  exitCodes: readonly number[],
  options: {
    readonly commits?: readonly string[];
    readonly finalPatch?: string;
  } = {},
) {
  const executionTask: ImplementationTask = {
    ...task,
    execution: {
      affectedPaths: ["src/command.ts"],
      cwd: "/repo",
      verifyCommand: "pnpm test",
      workflowInstructions: "implement",
    },
  };
  const source = new CompletedSource(executionTask);
  const registry = new AdapterRegistry();
  registry.register({ open: () => Promise.resolve(source), type: "memory" });
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner([
    {
      output: "first",
      session: { id: "runtime-session", resumeId: "agent-session" },
      status: "returned",
    },
    {
      output: "second",
      session: { id: "runtime-session", resumeId: "agent-session" },
      status: "returned",
    },
  ]);
  let verificationIndex = 0;
  const dispatcher = new Dispatcher({
    adapters: registry,
    git: new SequenceGit(
      [
        gitState("before"),
        gitState("after", options.finalPatch),
        gitState("after", options.finalPatch),
      ],
      options.commits,
    ),
    journal,
    runner,
    verifier: {
      verify: ({ command }) => {
        const exitCode = exitCodes[verificationIndex] ?? 0;
        verificationIndex += 1;
        return Promise.resolve({
          command,
          exitCode,
          output: `exit ${String(exitCode)}`,
        });
      },
    },
  });
  return { dispatcher, journal, runner, source };
}

function dispatcherFixture() {
  const source = new OutputBackedSource();
  const registry = new AdapterRegistry();
  registry.register({
    open: () => Promise.resolve(source),
    type: "memory",
  });
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner([
    {
      output: "I need a decision.",
      session: { id: "runtime-session", resumeId: "agent-session" },
      status: "returned",
    },
    {
      output: "complete",
      session: { id: "runtime-session", resumeId: "agent-session" },
      status: "returned",
    },
  ]);
  const dispatcher = new Dispatcher({ adapters: registry, journal, runner });
  return { dispatcher, journal, runner, source };
}

function sourceAttentionFixture(reason: AttentionReason) {
  const registry = new AdapterRegistry();
  const source: TaskSource = {
    completionEvidence: () =>
      Promise.resolve({
        attention: { detail: `Evidence for ${reason}.`, reason },
        status: "needs_attention",
      }),
    nextTask: (completed) =>
      Promise.resolve(completed.length === 0 ? task : null),
    reconcileCompleted: () => Promise.resolve(null),
  };
  registry.register({ open: () => Promise.resolve(source), type: "memory" });
  const journal = new InMemoryRunJournal();
  const dispatcher = new Dispatcher({
    adapters: registry,
    journal,
    runner: new FakeAgentRunner({
      output: "done",
      session: { id: `session-${reason}` },
      status: "returned",
    }),
  });
  return { dispatcher, journal };
}

describe("Dispatcher paused-session recovery", () => {
  it("appends a developer answer and continues the preserved session", async () => {
    const { dispatcher, journal, runner, source } = dispatcherFixture();
    const request = {
      completedTasks: [],
      planId: "run-answer",
      runId: "run-answer",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    await expect(dispatcher.dispatchOne(request)).resolves.toMatchObject({
      reason: "completion_evidence_missing",
      status: "needs_attention",
    });

    await expect(
      dispatcher.answer("Use the existing schema."),
    ).resolves.toMatchObject({
      status: "completed",
    });

    expect(runner.resumeRequests).toEqual([
      {
        instructions:
          "# Developer answer\n\nUse the existing schema.\n\nContinue the current task and return completion evidence.",
        session: { id: "runtime-session", resumeId: "agent-session" },
      },
    ]);
    expect(
      journal.events.filter((event) => event.type === "run_answered"),
    ).toHaveLength(1);
    expect(journal.releasedRunIds).toEqual(["run-answer"]);
    expect(source.marked).toBe(true);
  });

  it("sends a stored verification failure back for one explicit repair", async () => {
    const { dispatcher, journal, runner, source } = recoveryExecutionFixture([
      1, 0,
    ]);
    const request = {
      completedTasks: [],
      planId: "run-resume",
      runId: "run-resume",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    await dispatcher.dispatchOne(request);
    expect(source.marked).toBe(false);

    await expect(dispatcher.resume()).resolves.toMatchObject({
      status: "completed",
    });

    expect(runner.resumeRequests[0]?.instructions).toContain(
      "Reason: verification_failed",
    );
    expect(runner.resumeRequests[0]?.instructions).toContain("exit 1");
    expect(
      journal.events.filter((event) => event.type === "run_resumed"),
    ).toHaveLength(1);
    expect(source.marked).toBe(true);
  });
});

describe("Dispatcher recovery failures", () => {
  it("pauses again after a second evidence failure without another turn", async () => {
    const { dispatcher, journal, runner, source } = recoveryExecutionFixture([
      1, 1,
    ]);
    const request = {
      completedTasks: [],
      planId: "run-resume-twice",
      runId: "run-resume-twice",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    await dispatcher.dispatchOne(request);
    expect(source.marked).toBe(false);

    await expect(dispatcher.resume()).resolves.toMatchObject({
      reason: "verification_failed",
      status: "needs_attention",
    });

    expect(runner.resumeRequests).toHaveLength(1);
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(source.marked).toBe(false);
  });

  it("stays paused when the preserved session cannot be resumed", async () => {
    const source = new OutputBackedSource();
    const registry = new AdapterRegistry();
    registry.register({ open: () => Promise.resolve(source), type: "memory" });
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registry,
      journal,
      runner: {
        preflight: () => Promise.resolve(),
        resumeSession: () =>
          Promise.reject(new Error("replaced the preserved backend session")),
        runInNewSession: async (_request, sessionStarted) => {
          const session = {
            id: "runtime-session",
            resumeId: "agent-session",
          };
          await sessionStarted?.(session);
          return {
            output: "I need a decision.",
            session,
            status: "returned",
          };
        },
      },
    });
    await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-lost-session",
      runId: "run-lost-session",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    await expect(dispatcher.answer("Continue.")).resolves.toMatchObject({
      reason: "session_resume_failed",
      status: "needs_attention",
    });
    expect(journal.snapshots.at(-1)).toMatchObject({
      attention: { reason: "session_resume_failed" },
      status: "needs_attention",
    });
    expect(source.marked).toBe(false);
  });
});

describe("Dispatcher replacement-session recovery", () => {
  it("rejects a replacement session returned by a runner", async () => {
    const source = new OutputBackedSource();
    const registry = new AdapterRegistry();
    registry.register({ open: () => Promise.resolve(source), type: "memory" });
    const journal = new InMemoryRunJournal();
    const runner = new FakeAgentRunner([
      {
        output: "I need a decision.",
        session: { id: "runtime-session", resumeId: "agent-session" },
        status: "returned",
      },
      {
        output: "complete",
        session: { id: "runtime-session", resumeId: "replacement-session" },
        status: "returned",
      },
    ]);
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });
    await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-replacement-session",
      runId: "run-replacement-session",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    await expect(dispatcher.answer("Continue.")).resolves.toMatchObject({
      reason: "session_resume_failed",
      status: "needs_attention",
    });
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(source.marked).toBe(false);
  });
});

describe("Dispatcher attention evidence", () => {
  it.each([
    "completion_evidence_missing",
    "human_log_missing",
    "review_evidence_missing",
  ] as const)("persists the %s task-source reason", async (reason) => {
    const { dispatcher, journal } = sourceAttentionFixture(reason);

    await dispatcher.dispatchOne({
      completedTasks: [],
      planId: `run-${reason}`,
      runId: `run-${reason}`,
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(journal.snapshots.at(-1)?.attention?.reason).toBe(reason);
    expect(journal.events.at(-1)).toMatchObject({ attention: { reason } });
  });

  it.each([
    ["commit_evidence_missing", { commits: [] }],
    ["dirty_final_state", { finalPatch: "changed" }],
  ] as const)("persists the %s execution reason", async (reason, options) => {
    const { dispatcher, journal } = recoveryExecutionFixture([0], options);

    await dispatcher.dispatchOne({
      completedTasks: [],
      planId: `run-${reason}`,
      runId: `run-${reason}`,
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(journal.snapshots.at(-1)?.attention?.reason).toBe(reason);
    expect(journal.events.at(-1)).toMatchObject({ attention: { reason } });
  });
});
