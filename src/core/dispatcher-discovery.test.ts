import { describe, expect, it } from "vitest";

import { AdapterRegistry, Dispatcher } from "../index.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";
import type {
  DiscoveryDecision,
  DispatchRequest,
  GitRepository,
  GitState,
  ReviewTurn,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  TaskCompletionEvidence,
  Verifier,
} from "./contracts.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "private workflow",
  },
  identity: { id: "slice-01", revision: "rev-1" },
  instructions: "Implement slice 01.",
  title: "Bootstrap the dispatch core",
} as const;

function request(runId: string): DispatchRequest {
  return {
    completedTasks: [],
    planId: runId,
    runId,
    skills: [],
    taskSource: { location: "memory://plan", type: "memory" },
  };
}

function state(head = "before"): GitState {
  return {
    dirtyPaths: [],
    head,
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  };
}

class DiscoveryGit implements GitRepository {
  private index = 0;

  constructor(private readonly states: readonly GitState[]) {}

  changedPaths(): Promise<readonly string[]> {
    return Promise.resolve(["src/task.ts"]);
  }

  commitsBetween(
    _root: string,
    _ancestor: string,
    descendant: string,
  ): Promise<readonly string[]> {
    return Promise.resolve([descendant]);
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

class CompletionCrashJournal implements RunJournal {
  readonly inner = new InMemoryRunJournal();
  private crash = true;

  append(event: RunJournalEvent): Promise<void> {
    if (this.crash && event.type === "task_completed") {
      this.crash = false;
      return Promise.reject(new Error("simulated completion crash"));
    }
    return this.inner.append(event);
  }

  load(planId: string): Promise<RunRecoveryState | null> {
    return this.inner.load(planId);
  }

  loadActive(): Promise<RunRecoveryState | null> {
    return this.inner.loadActive();
  }
}

const verifier: Verifier = {
  verify: ({ command }) =>
    Promise.resolve({ command, exitCode: 0, output: "ok" }),
};
const verificationLocator = {
  command: "pnpm check",
  exitCode: 0,
  kind: "verification" as const,
  output: "ok",
};

function fixture(
  discovery: NonNullable<TaskCompletionEvidence["discoveries"]>[number],
  decision: DiscoveryDecision,
) {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      [task.identity.id]: {
        discoveries: [discovery],
        summary: "discovery recorded",
      },
    }),
  );
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner(
    {
      output: "implementation result",
      session: { id: "implementation" },
      status: "returned",
    },
    [
      {
        result: {
          findings: [],
          kind: "standards",
          resultCommit: "after",
          startCommit: "before",
          verdict: "passed",
        },
        session: { id: "standards" },
        status: "returned",
      },
      {
        result: {
          discoveryDecisions: [decision],
          findings: [],
          kind: "plan_compliance",
          outcomeFactDecisions: [],
          resultCommit: "after",
          startCommit: "before",
          verdict: "passed",
        },
        session: { id: "plan" },
        status: "returned",
      },
    ],
  );
  return {
    dispatcher: new Dispatcher({
      adapters: registry,
      git: new DiscoveryGit([state(), state("after"), state("after")]),
      journal,
      runner,
      verifier,
    }),
    journal,
    runner,
  };
}

const recoveryDiscovery = {
  id: "A1",
  kind: "assumption",
  locator: verificationLocator,
  reason: "The verified behavior contradicts the plan.",
  state: "disproved",
} as const;
const recoveryDecision = {
  decision: "accepted",
  id: "A1",
  kind: "assumption",
  reason: "The verification confirms the contradiction.",
} as const;

function recoveryReviews(): readonly ReviewTurn[] {
  return [
    {
      result: {
        findings: [],
        kind: "standards",
        resultCommit: "after",
        startCommit: "before",
        verdict: "passed",
      },
      session: { id: "standards" },
      status: "returned",
    },
    {
      error: "plan reviewer disconnected",
      session: { id: "plan-interrupted" },
      status: "failed",
    },
    {
      result: {
        discoveryDecisions: [recoveryDecision],
        findings: [],
        kind: "plan_compliance",
        outcomeFactDecisions: [],
        resultCommit: "after",
        startCommit: "before",
        verdict: "passed",
      },
      session: { id: "plan-recovered" },
      status: "returned",
    },
  ];
}

function interruptedRecoveryFixture() {
  const nextTask = {
    ...task,
    identity: { id: "slice-02", revision: "rev-2" },
    title: "A task that must remain pending",
  };
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter("memory", [task, nextTask], {
      [task.identity.id]: {
        discoveries: [recoveryDiscovery],
        summary: "done",
      },
      [nextTask.identity.id]: { summary: "not reached" },
    }),
  );
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner(
    {
      output: "implementation result",
      session: { id: "implementation" },
      status: "returned",
    },
    recoveryReviews(),
  );
  return {
    dispatcher: new Dispatcher({
      adapters: registry,
      git: new DiscoveryGit([state(), state("after"), state("after")]),
      journal,
      runner,
      verifier,
    }),
    journal,
  };
}

function completionCrashFixture() {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      [task.identity.id]: {
        discoveries: [recoveryDiscovery],
        summary: "done",
      },
    }),
  );
  const journal = new CompletionCrashJournal();
  const runner = new FakeAgentRunner(
    {
      output: "implementation result",
      session: { id: "implementation" },
      status: "returned",
    },
    recoveryReviews().filter((turn) => turn.status === "returned"),
  );
  return {
    dispatcher: new Dispatcher({
      adapters: registry,
      git: new DiscoveryGit([state(), state("after"), state("after")]),
      journal,
      runner,
      verifier,
    }),
    journal,
  };
}

describe("Dispatcher default discoveries", () => {
  it("records an accepted deviation and completes the task", async () => {
    const test = fixture(
      {
        deviation: "Keep the existing internal command name.",
        id: "D1",
        kind: "default",
        locator: verificationLocator,
      },
      {
        decision: "accepted",
        id: "D1",
        kind: "default",
        reason: "The deviation stays inside the task contract.",
      },
    );

    await expect(
      test.dispatcher.dispatchOne(request("default")),
    ).resolves.toMatchObject({
      status: "completed",
    });
    expect(
      test.journal.events.find(
        (event) => event.type === "ledger_transition_recorded",
      ),
    ).toMatchObject({
      transition: { id: "D1", kind: "default", state: "deviated" },
    });
  });
});

describe("Dispatcher assumption discoveries", () => {
  it("completes the task and pauses before another selection", async () => {
    const test = fixture(
      {
        id: "A1",
        kind: "assumption",
        locator: verificationLocator,
        reason: "The verified behavior contradicts the plan.",
        state: "disproved",
      },
      {
        decision: "accepted",
        id: "A1",
        kind: "assumption",
        reason: "The stored verification confirms the contradiction.",
      },
    );

    await expect(
      test.dispatcher.dispatchOne(request("assumption")),
    ).resolves.toMatchObject({
      reason: "assumption_disproved",
      status: "needs_attention",
    });
    expect(test.journal.events.at(-1)?.type).toBe("task_completed");
    expect(test.journal.snapshots.at(-1)).toMatchObject({
      status: "needs_attention",
      task: null,
    });
    expect(await test.dispatcher.inspectRecovery()).toMatchObject({
      task: null,
      attention: { reason: "assumption_disproved" },
      availability: { answer: null },
    });
    await expect(
      test.dispatcher.answer("Acknowledge the disproof and stop the plan."),
    ).resolves.toMatchObject({ status: "source_exhausted" });
    expect(test.journal.events.map((event) => event.type)).toContain(
      "ledger_attention_answered",
    );
  });
});

describe("Dispatcher discovery recovery", () => {
  it("preserves a pause recovered after reviewer interruption", async () => {
    const { dispatcher, journal } = interruptedRecoveryFixture();

    await expect(
      dispatcher.dispatchOne(request("recovery")),
    ).resolves.toMatchObject({
      reason: "plan_compliance_review_interrupted",
      status: "needs_attention",
    });
    await expect(dispatcher.resume()).resolves.toMatchObject({
      reason: "assumption_disproved",
      status: "needs_attention",
    });
    expect(
      journal.events.filter((event) => event.type === "task_selected"),
    ).toHaveLength(1);
    expect(journal.snapshots.at(-1)).toMatchObject({
      attention: { reason: "assumption_disproved" },
      status: "needs_attention",
      task: null,
    });
  });

  it("recovers a pause persisted before task completion", async () => {
    const { dispatcher, journal } = completionCrashFixture();

    await expect(dispatcher.dispatchOne(request("crash"))).rejects.toThrow(
      "simulated completion crash",
    );
    await expect(dispatcher.resume()).resolves.toMatchObject({
      reason: "assumption_disproved",
      status: "needs_attention",
    });
    expect(
      journal.inner.events.filter((event) => event.type === "task_selected"),
    ).toHaveLength(1);
    expect(journal.inner.snapshots.at(-1)).toMatchObject({
      attention: { reason: "assumption_disproved" },
      status: "needs_attention",
      task: null,
    });
  });
});

describe("Dispatcher invalid discoveries", () => {
  it("rejects a mismatched locator before review", async () => {
    const test = fixture(
      {
        deviation: "Use another check.",
        id: "D1",
        kind: "default",
        locator: { ...verificationLocator, command: "pnpm test" },
      },
      {
        decision: "accepted",
        id: "D1",
        kind: "default",
        reason: "unused",
      },
    );

    await expect(
      test.dispatcher.dispatchOne(request("invalid")),
    ).resolves.toMatchObject({
      reason: "completion_evidence_missing",
      status: "needs_attention",
    });
    expect(test.runner.reviewRequests).toEqual([]);
  });
});
