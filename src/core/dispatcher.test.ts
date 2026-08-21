import { describe, expect, it } from "vitest";

import { AdapterRegistry, Dispatcher } from "../index.js";
import type { GitRepository, GitState, Verifier } from "./contracts.js";
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
    expect(journal.deletedRunIds).toEqual(["run-1"]);
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
      runId: "run-2",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("needs_attention");
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(journal.deletedRunIds).toEqual([]);
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
      runId: "run-3",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("failed");
    expect(journal.snapshots.at(-1)?.status).toBe("failed");
    expect(journal.deletedRunIds).toEqual([]);
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
    expect(journal.deletedRunIds).toEqual([]);
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
        runId: "run-5",
        skills: [],
        taskSource: { location: "memory://plan", type: "memory" },
      }),
    ).rejects.toThrow("Task overlaps dirty path: src/cli.ts");
    expect(journal.events).toEqual([]);
  });
});
