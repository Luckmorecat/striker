import { expect, it } from "vitest";

import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { GitRepository, GitState, Verifier } from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task = {
  execution: {
    affectedPaths: ["src/cli.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm test",
    workflowInstructions: "private workflow",
  },
  identity: { id: "slice-01", revision: "rev-1" },
  instructions: "Implement slice 01.",
  title: "Bootstrap the dispatch core",
} as const;

function state(head: string): GitState {
  return {
    dirtyPaths: [],
    head,
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  };
}

class FakeGit implements GitRepository {
  private index = 0;

  constructor(
    readonly states: readonly GitState[] = [state("before"), state("after")],
  ) {}

  changedPaths(): Promise<readonly string[]> {
    return Promise.resolve(["src/cli.ts"]);
  }

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

function registry(): AdapterRegistry {
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      "slice-01": { summary: "complete" },
    }),
  );
  return adapters;
}

it("records complete task state from exact execution evidence", async () => {
  const journal = new InMemoryRunJournal();
  const dispatcher = new Dispatcher({
    adapters: registry(),
    git: new FakeGit(),
    journal,
    runner: new FakeAgentRunner({
      output: "done",
      session: { id: "session-4" },
      status: "returned",
    }),
    verifier: verifier(0),
  });

  await dispatcher.dispatchOne({
    completedTasks: [],
    planId: "plan-4",
    runId: "run-4",
    skills: [],
    taskSource: { location: "memory://plan", type: "memory" },
  });

  const completion = journal.events.find(
    (event) => event.type === "task_completed",
  );
  expect(completion).toMatchObject({
    attempt: 1,
    changedPaths: ["src/cli.ts"],
    resultCommit: "after",
    runId: "run-4",
    session: { id: "session-4" },
    startCommit: "before",
    task: task.identity,
    type: "task_completed",
    verification: { command: "pnpm test", exitCode: 0, output: "ok" },
  });
  expect(completion).toHaveProperty("completedAt", expect.stringMatching(/Z$/));
});

it("keeps workflow instructions separate and pauses on verification", async () => {
  const runner = new FakeAgentRunner({
    output: "done",
    session: { id: "session-4" },
    status: "returned",
  });
  const journal = new InMemoryRunJournal();
  const dispatcher = new Dispatcher({
    adapters: registry(),
    git: new FakeGit(),
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

it("rejects a checkout that changes while its review is running", async () => {
  const journal = new InMemoryRunJournal();
  const dispatcher = new Dispatcher({
    adapters: registry(),
    git: new FakeGit([state("before"), state("after"), state("replacement")]),
    journal,
    runner: new FakeAgentRunner({
      output: "done",
      session: { id: "session-4" },
      status: "returned",
    }),
    verifier: verifier(0),
  });

  await expect(
    dispatcher.dispatchOne({
      completedTasks: [],
      planId: "plan-live-review",
      runId: "run-live-review",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    }),
  ).resolves.toMatchObject({
    reason: "commit_evidence_missing",
    status: "needs_attention",
  });
  expect(journal.events.some((event) => event.type === "task_completed")).toBe(
    false,
  );
});
