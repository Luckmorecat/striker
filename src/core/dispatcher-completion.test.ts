import { expect, it } from "vitest";

import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  GitRepository,
  GitState,
  ImplementationTask,
  Verifier,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";
import type { OutcomeFactProposal } from "./outcome-contracts.js";

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

  readFileAtCommit(): Promise<string | null> {
    return Promise.resolve("export const outcome = true;");
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

const outcomeTarget = { id: "tasks/02.md", revision: "target-revision" };
const outcomeTask = {
  ...task,
  identity: { id: "tasks/01.md", revision: "source-revision" },
  outcomeRoutes: [outcomeTarget],
  outcomeTaskOrder: [
    { id: "tasks/01.md", revision: "source-revision" },
    outcomeTarget,
  ],
  outcomeTargets: [
    {
      contract: "# Consume evidence\n\nImplement the target.",
      identity: outcomeTarget,
    },
  ],
};
const outcomeFacts = [
  {
    category: "public_contract",
    evidence: {
      kind: "code",
      line: 1,
      path: "src/cli.ts",
      text: "export const outcome = true;",
    },
    id: "F1",
    relevantTo: [outcomeTarget.id],
    statement: "The public command returns success.",
  },
  {
    category: "verified_default",
    evidence: {
      command: "pnpm test",
      exitCode: 0,
      kind: "verification",
      output: "ok",
    },
    id: "F2",
    relevantTo: [outcomeTarget.id],
    statement: "The command uses the default mode.",
  },
] as const;
const outcomePlanResult = {
  discoveryDecisions: [],
  findings: [],
  kind: "plan_compliance" as const,
  outcomeFactDecisions: [
    {
      decision: "accepted" as const,
      id: "F1",
      reason: "Supported.",
    },
    {
      decision: "rejected" as const,
      id: "F2",
      reason: "Not proven.",
    },
  ],
  resultCommit: "after",
  startCommit: "before",
  verdict: "passed" as const,
};

function outcomeFixture() {
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [outcomeTask], {
      [outcomeTask.identity.id]: {
        outcomeFacts,
        summary: "complete",
      },
    }),
  );
  const runner = new FakeAgentRunner(
    {
      output: "done",
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
        result: outcomePlanResult,
        session: { id: "plan" },
        status: "returned",
      },
    ],
  );
  const journal = new InMemoryRunJournal();
  return {
    dispatcher: new Dispatcher({
      adapters,
      git: new FakeGit(),
      journal,
      runner,
      verifier: verifier(0),
    }),
    journal,
    runner,
  };
}

it("certifies routed Outcome Facts and permits rejected facts", async () => {
  const { dispatcher, journal, runner } = outcomeFixture();

  await expect(
    dispatcher.dispatchOne({
      completedTasks: [],
      planId: "outcomes",
      runId: "outcomes",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    }),
  ).resolves.toMatchObject({ status: "completed" });
  const resolvedFacts = [
    {
      ...outcomeFacts[0],
      evidence: { ...outcomeFacts[0].evidence, commit: "after" },
    },
    outcomeFacts[1],
  ];
  expect(
    journal.events.find(
      (event) => event.type === "plan_compliance_review_started",
    ),
  ).toMatchObject({ outcomeFacts: resolvedFacts });
  expect(
    journal.events.find(
      (event) => event.type === "plan_compliance_review_completed",
    ),
  ).toMatchObject({ result: outcomePlanResult });
  expect(runner.reviewRequests[0]?.instructions).not.toContain(
    '"outcomeFacts"',
  );
  expect(runner.reviewRequests[1]?.instructions).toContain('"outcomeFacts"');
});

const verificationFact: OutcomeFactProposal = {
  category: "public_contract",
  evidence: {
    command: "pnpm test",
    exitCode: 0,
    kind: "verification",
    output: "ok",
  },
  id: "F1",
  relevantTo: ["tasks/02.md"],
  statement: "The public command returns success.",
};

async function dispatchInvalidOutcome(
  selectedTask: ImplementationTask,
  fact: OutcomeFactProposal,
) {
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [selectedTask], {
      [selectedTask.identity.id]: {
        outcomeFacts: [fact],
        summary: "complete",
      },
    }),
  );
  const runner = new FakeAgentRunner({
    output: "done",
    session: { id: "implementation" },
    status: "returned",
  });
  const result = await new Dispatcher({
    adapters,
    git: new FakeGit(),
    journal: new InMemoryRunJournal(),
    runner,
    verifier: verifier(0),
  }).dispatchOne({
    completedTasks: [],
    planId: "invalid-outcome",
    runId: "invalid-outcome",
    skills: [],
    taskSource: { location: "memory://plan", type: "memory" },
  });
  return { result, reviewRequests: runner.reviewRequests };
}

it("rejects Outcome Facts outside the source route before review", async () => {
  const selectedTask = {
    ...outcomeTask,
    outcomeRoutes: [],
    outcomeTargets: [],
  };
  const test = await dispatchInvalidOutcome(selectedTask, verificationFact);

  expect(test.result).toMatchObject({
    reason: "completion_evidence_missing",
    status: "needs_attention",
  });
  expect(test.reviewRequests).toHaveLength(0);
});

it("rejects malformed Outcome Fact evidence before review", async () => {
  const fact = {
    ...verificationFact,
    evidence: {
      command: "pnpm test",
      exitCode: 0,
      kind: "invalid",
      output: "ok",
    },
  } as unknown as OutcomeFactProposal;
  const test = await dispatchInvalidOutcome(outcomeTask, fact);

  expect(test.result).toMatchObject({
    reason: "completion_evidence_missing",
    status: "needs_attention",
  });
  expect(test.reviewRequests).toHaveLength(0);
});

it("rejects unknown and backward Outcome Fact routes in core", async () => {
  const unknownTarget = { id: "tasks/99.md", revision: "unknown" };
  const unknownTask = {
    ...outcomeTask,
    outcomeRoutes: [unknownTarget],
    outcomeTargets: [{ contract: "# Unknown", identity: unknownTarget }],
  };
  const backwardTarget = { id: "tasks/01.md", revision: "target" };
  const backwardTask = {
    ...outcomeTask,
    identity: { id: "tasks/02.md", revision: "source" },
    outcomeRoutes: [backwardTarget],
    outcomeTaskOrder: [
      backwardTarget,
      { id: "tasks/02.md", revision: "source" },
    ],
    outcomeTargets: [{ contract: "# Earlier task", identity: backwardTarget }],
  };
  const unknown = await dispatchInvalidOutcome(unknownTask, {
    ...verificationFact,
    relevantTo: [unknownTarget.id],
  });
  const backward = await dispatchInvalidOutcome(backwardTask, {
    ...verificationFact,
    relevantTo: [backwardTarget.id],
  });

  expect(unknown.result).toMatchObject({
    reason: "completion_evidence_missing",
  });
  expect(backward.result).toMatchObject({
    reason: "completion_evidence_missing",
  });
  expect(unknown.reviewRequests).toHaveLength(0);
  expect(backward.reviewRequests).toHaveLength(0);
});
