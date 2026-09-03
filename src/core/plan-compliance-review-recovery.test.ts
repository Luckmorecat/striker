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
  ReviewTurn,
  Verifier,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity: { id: "tasks/06.md", revision: "revision-6" },
  instructions: "Build plan-compliance review.",
  title: "Review plan compliance",
} as const;
const request = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
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

class GitSequence implements GitRepository {
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
    if (value === undefined) throw new Error("Missing Git state");
    return Promise.resolve(value);
  }

  resolvePrivatePath(): Promise<string> {
    return Promise.resolve("/repo/.git/striker");
  }

  resolveRoot(): Promise<string> {
    return Promise.resolve("/repo");
  }
}

function passed(kind: "plan_compliance" | "standards"): ReviewTurn {
  const common = {
    findings: [],
    resultCommit: "candidate",
    startCommit: "baseline",
    verdict: "passed" as const,
  };
  return {
    result:
      kind === "plan_compliance"
        ? { ...common, discoveryDecisions: [], kind }
        : { ...common, kind },
    session: { id: `${kind}-reviewer` },
    status: "returned",
  };
}

const verifier: Verifier = {
  verify: ({ command }) =>
    Promise.resolve({ command, exitCode: 0, output: "ok" }),
};

it("recovers an interrupted plan review without rerunning standards", async () => {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      [task.identity.id]: { summary: "implementation complete" },
    }),
  );
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner(
    {
      output: "implementation result",
      session: { id: "implementor" },
      status: "returned",
    },
    [
      passed("standards"),
      {
        error: "plan reviewer disconnected",
        session: { id: "plan-reviewer-1" },
        status: "failed",
      },
      passed("plan_compliance"),
    ],
  );
  const dispatcher = new Dispatcher({
    adapters: registry,
    git: new GitSequence([
      state("baseline"),
      state("candidate"),
      state("candidate"),
    ]),
    journal,
    runner,
    verifier,
  });

  await expect(dispatcher.dispatchOne(request)).resolves.toMatchObject({
    reason: "plan_compliance_review_interrupted",
    status: "needs_attention",
  });
  await expect(dispatcher.resume()).resolves.toMatchObject({
    status: "completed",
  });

  expect(
    runner.reviewRequests.filter((review) =>
      review.instructions.includes("# Independent standards review"),
    ),
  ).toHaveLength(1);
  expect(
    runner.reviewRequests.filter((review) =>
      review.instructions.includes("# Independent plan-compliance review"),
    ),
  ).toHaveLength(2);
  expect(journal.events.at(-2)).toMatchObject({
    certification: "independent_reviews",
    type: "task_completed",
  });
});

const blockingPlanReview: ReviewTurn = {
  result: {
    discoveryDecisions: [],
    findings: [
      {
        fix: "Add the missing recovery behavior.",
        kind: "plan_violation",
        location: { line: 1 },
        message: "Recovery is incomplete.",
        path: "src/task.ts",
        rule: "Task Build",
        severity: "blocking",
      },
    ],
    kind: "plan_compliance",
    resultCommit: "candidate",
    startCommit: "baseline",
    verdict: "changes_required",
  },
  session: { id: "plan-reviewer-1" },
  status: "returned",
};

function passedAmended(kind: "plan_compliance" | "standards"): ReviewTurn {
  const common = {
    findings: [],
    resultCommit: "candidate-2",
    startCommit: "baseline",
    verdict: "passed" as const,
  };
  return {
    result:
      kind === "plan_compliance"
        ? { ...common, discoveryDecisions: [], kind }
        : { ...common, kind },
    session: { id: `${kind}-reviewer-2` },
    status: "returned",
  };
}

function repairFixture(
  states: readonly GitState[] = [
    state("baseline"),
    state("candidate"),
    state("candidate-2"),
    state("candidate-2"),
  ],
  reviewTurns: readonly ReviewTurn[] = [
    passed("standards"),
    blockingPlanReview,
    passedAmended("standards"),
    passedAmended("plan_compliance"),
  ],
) {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      [task.identity.id]: { summary: "implementation complete" },
    }),
  );
  const runner = new FakeAgentRunner(
    [
      {
        output: "implementation result",
        session: { id: "implementor" },
        status: "returned",
      },
      {
        output:
          '{"discoveries":[],"kind":"implementation","outcomeFacts":[],"summary":"Repaired."}',
        session: { id: "implementor" },
        status: "returned",
      },
      {
        output:
          '{"discoveries":[],"kind":"implementation","outcomeFacts":[],"summary":"Amended."}',
        session: { id: "implementor" },
        status: "returned",
      },
    ],
    reviewTurns,
  );
  const journal = new InMemoryRunJournal();
  const dispatcher = new Dispatcher({
    adapters: registry,
    git: new GitSequence(states),
    journal,
    runner,
    verifier,
  });
  return { dispatcher, journal, runner };
}

it("restarts standards and plan review after a plan-compliance repair", async () => {
  const { dispatcher, journal, runner } = repairFixture();

  await expect(dispatcher.dispatchOne(request)).resolves.toMatchObject({
    status: "completed",
  });

  expect(
    journal.events
      .filter(
        (event) =>
          event.type === "standards_review_started" ||
          event.type === "plan_compliance_review_started",
      )
      .map((event) => event.type),
  ).toEqual([
    "standards_review_started",
    "plan_compliance_review_started",
    "standards_review_started",
    "plan_compliance_review_started",
  ]);
  expect(runner.resumeRequests[0]?.instructions).toContain(
    "plan-compliance review findings",
  );
  expect(journal.events.at(-2)).toMatchObject({
    certification: "independent_reviews",
    resultCommit: "candidate-2",
    type: "task_completed",
  });
});

it("recovers restarted standards review without stale plan repair state", async () => {
  const failedStandards: ReviewTurn = {
    error: "standards reviewer disconnected",
    session: { id: "standards-reviewer-2" },
    status: "failed",
  };
  const { dispatcher, journal } = repairFixture(undefined, [
    passed("standards"),
    blockingPlanReview,
    failedStandards,
    passedAmended("standards"),
    passedAmended("plan_compliance"),
  ]);

  await expect(dispatcher.dispatchOne(request)).resolves.toMatchObject({
    reason: "standards_review_interrupted",
    status: "needs_attention",
  });
  expect(journal.snapshots.at(-1)?.planComplianceReview).toBeNull();

  await expect(dispatcher.resume()).resolves.toMatchObject({
    status: "completed",
  });
});

it("returns plan repair attention to the implementor until the commit changes", async () => {
  const { dispatcher, journal } = repairFixture([
    state("baseline"),
    state("candidate"),
    state("candidate"),
    state("candidate-2"),
    state("candidate-2"),
  ]);

  await expect(dispatcher.dispatchOne(request)).resolves.toMatchObject({
    reason: "commit_evidence_missing",
    status: "needs_attention",
  });
  expect(journal.snapshots.at(-1)?.planComplianceReview?.stage).toBe(
    "repair_attention",
  );

  await expect(
    dispatcher.answer("Amend the rejected commit."),
  ).resolves.toMatchObject({ status: "completed" });
});
