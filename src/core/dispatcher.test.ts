import { describe, expect, it } from "vitest";

import { AdapterRegistry, Dispatcher } from "../index.js";
import type {
  AgentRunner,
  DispatchRequest,
  GitRepository,
  GitState,
  Verifier,
} from "./contracts.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";

const task = {
  identity: { id: "slice-01", revision: "rev-1" },
  title: "Bootstrap the dispatch core",
  instructions: "Implement slice 01.",
} as const;

function recoveryRequest(runId: string): DispatchRequest {
  return {
    completedTasks: [],
    planId: runId,
    runId,
    skills: [],
    taskSource: { location: "memory://plan", type: "memory" },
  };
}

async function seedCompletedTask(
  journal: InMemoryRunJournal,
  request: DispatchRequest,
): Promise<void> {
  const session = { id: "old-session" };
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: null,
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
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_completed",
  });
}

function state(overrides: Partial<GitState> = {}): GitState {
  return {
    dirtyPaths: [],
    head: "before",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
    ...overrides,
  };
}

class FakeGit implements GitRepository {
  constructor(private readonly states: readonly GitState[]) {}
  private index = 0;

  commitsBetween(): Promise<readonly string[]> {
    return Promise.resolve(["after"]);
  }

  inspect(): Promise<GitState> {
    const value = this.states[this.index] ?? this.states.at(-1);
    this.index += 1;
    if (value === undefined) throw new Error("Missing fake Git state");
    return Promise.resolve(value);
  }

  resolvePrivatePath(): Promise<string> {
    return Promise.resolve("/repo/.git/striker");
  }

  resolveRoot(): Promise<string> {
    return Promise.resolve("/repo");
  }
}

function verifier(exitCode: number): Verifier {
  return {
    verify: ({ command }) =>
      Promise.resolve({
        command,
        exitCode,
        output: exitCode === 0 ? "ok" : "no",
      }),
  };
}

function registryWithEvidence(summary?: string): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter(
      "memory",
      [task],
      summary === undefined ? {} : { "slice-01": { summary } },
    ),
  );
  return registry;
}

describe("Dispatcher", () => {
  it("dispatches one task and returns source-backed completion evidence", async () => {
    const evidence = { summary: "slice 01 is complete" } as const;
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(evidence.summary),
      journal,
      runner: new FakeAgentRunner({
        output: "Implementation finished.",
        session: { id: "session-1" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-1",
      runId: "run-1",
      skills: ["next-slice"],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toEqual({
      evidence,
      runId: "run-1",
      session: { id: "session-1" },
      status: "completed",
      task,
    });
    expect(journal.releasedRunIds).toEqual(["run-1"]);
  });

  it("needs attention when the source has no completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(),
      journal,
      runner: new FakeAgentRunner({
        output: "This output is not completion proof.",
        session: { id: "session-2" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-2",
      runId: "run-2",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("needs_attention");
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(journal.releasedRunIds).toEqual([]);
  });

  it("persists a failed agent turn without accepting completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence("would otherwise complete"),
      journal,
      runner: new FakeAgentRunner({
        error: "agent process exited",
        session: { id: "session-3" },
        status: "failed",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-3",
      runId: "run-3",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("failed");
    expect(journal.snapshots.at(-1)?.status).toBe("failed");
    expect(journal.releasedRunIds).toEqual([]);
  });
});

describe("Dispatcher sequential execution", () => {
  it("dispatches every task sequentially with a fresh session", async () => {
    const secondTask = {
      identity: { id: "slice-02", revision: "rev-2" },
      instructions: "Implement slice 02.",
      title: "Finish the dispatch core",
    } as const;
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [task, secondTask], {
        "slice-01": { summary: "slice 01 complete" },
        "slice-02": { summary: "slice 02 complete" },
      }),
    );
    const runner = new FakeAgentRunner([
      {
        output: "first done",
        session: { id: "session-1" },
        status: "returned",
      },
      {
        output: "second done",
        session: { id: "session-2" },
        status: "returned",
      },
    ]);
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch({
      completedTasks: [],
      planId: "run-all",
      runId: "run-all",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toMatchObject({ status: "completed", task: secondTask });
    expect(runner.requests).toHaveLength(2);
    expect(
      journal.events
        .filter((event) => event.type === "task_completed")
        .map((event) => event.session.id),
    ).toEqual(["session-1", "session-2"]);
    expect(
      journal.events.filter((event) => event.type === "run_started"),
    ).toHaveLength(1);
    expect(journal.releasedRunIds).toEqual(["run-all"]);
    expect(runner.preflightRequests).toEqual([{ skills: [] }]);
  });

  it("does not start task work or a journal after failed preflight", async () => {
    const journal = new InMemoryRunJournal();
    const runner: AgentRunner = {
      preflight: () => Promise.reject(new Error('Harness "pi" is unavailable')),
      resumeSession: () => {
        throw new Error("Task session must not resume");
      },
      runInNewSession: () => {
        throw new Error("Task session must not start");
      },
    };
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence("complete"),
      journal,
      runner,
    });

    await expect(
      dispatcher.dispatch({
        completedTasks: [],
        planId: "run-preflight",
        runId: "run-preflight",
        skills: ["security"],
        taskSource: { location: "memory://plan", type: "memory" },
      }),
    ).rejects.toThrow('Harness "pi" is unavailable');
    expect(journal.events).toEqual([]);
    expect(journal.snapshots).toEqual([]);
  });
});

describe("Dispatcher journal recovery", () => {
  it("resumes at the first task absent from the durable journal", async () => {
    const request = recoveryRequest("run-resume");
    const secondTask = {
      identity: { id: "slice-02", revision: "rev-2" },
      instructions: "Implement slice 02.",
      title: "Finish the dispatch core",
    } as const;
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [task, secondTask], {
        "slice-02": { summary: "slice 02 complete" },
      }),
    );
    const journal = new InMemoryRunJournal();
    await seedCompletedTask(journal, request);
    const runner = new FakeAgentRunner({
      output: "second done",
      session: { id: "new-session" },
      status: "returned",
    });
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch(request);

    expect(result).toMatchObject({ status: "completed", task: secondTask });
    expect(runner.lastRequest?.instructions).toBe(secondTask.instructions);
  });

  it("needs attention when a completed task identity changed", async () => {
    const request = recoveryRequest("run-changed");
    const changedTask = {
      ...task,
      identity: { id: task.identity.id, revision: "changed-revision" },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [changedTask], {}),
    );
    const journal = new InMemoryRunJournal();
    await seedCompletedTask(journal, request);
    const runner = new FakeAgentRunner({
      output: "unused",
      session: { id: "unused" },
      status: "returned",
    });
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch(request);

    expect(result).toEqual({
      completedTask: task.identity,
      currentTask: changedTask.identity,
      reason: "completed_task_changed",
      runId: "run-changed",
      session: null,
      status: "needs_attention",
      task: null,
    });
    expect(runner.requests).toEqual([]);
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
  });
});

describe("Dispatcher execution evidence", () => {
  it("keeps the private workflow separate and pauses on failed verification", async () => {
    const executionTask = {
      ...task,
      execution: {
        affectedPaths: ["src/cli.ts"],
        cwd: "/repo",
        verifyCommand: "pnpm test",
        workflowInstructions: "private workflow",
      },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [executionTask], {
        "slice-01": { summary: "complete" },
      }),
    );
    const runner = new FakeAgentRunner({
      output: "done",
      session: { id: "session-4" },
      status: "returned",
    });
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registry,
      git: new FakeGit([state(), state({ head: "after" })]),
      journal,
      runner,
      verifier: verifier(1),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      planId: "run-4",
      runId: "run-4",
      skills: ["security"],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toMatchObject({
      reason: "verification_failed",
      status: "needs_attention",
    });
    expect(runner.lastRequest).toEqual({
      instructions: task.instructions,
      skills: ["security"],
      workflowInstructions: "private workflow",
    });
    expect(journal.releasedRunIds).toEqual([]);
  });
});

describe("Dispatcher dirty baseline", () => {
  it("rejects a task that overlaps the preserved dirty baseline", async () => {
    const executionTask = {
      ...task,
      execution: {
        affectedPaths: ["src/cli.ts"],
        cwd: "/repo",
        verifyCommand: "pnpm test",
        workflowInstructions: "private workflow",
      },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [executionTask], {}),
    );
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registry,
      git: new FakeGit([state({ dirtyPaths: ["src/cli.ts"] })]),
      journal,
      runner: new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
      verifier: verifier(0),
    });

    await expect(
      dispatcher.dispatchOne({
        allowDirty: true,
        completedTasks: [],
        planId: "run-5",
        runId: "run-5",
        skills: [],
        taskSource: { location: "memory://plan", type: "memory" },
      }),
    ).rejects.toThrow("Task overlaps dirty path: src/cli.ts");
    expect(journal.events).toEqual([]);
  });
});
