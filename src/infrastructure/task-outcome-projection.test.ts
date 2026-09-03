import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { RunJournalEvent } from "../core/contracts.js";
import { writePlanProjections } from "./plan-projections.js";
import { replayPlanJournal } from "./run-journal-sequence.js";
import { orderTaskOutcomes } from "./task-outcome-projection.js";

const source = { id: "tasks/01.md", revision: "source-revision" };
const target = { id: "tasks/02.md", revision: "target-revision" };
const candidate = {
  attempt: 1,
  changedPaths: ["src/outcome.ts"],
  resultCommit: "result-commit",
  startCommit: "start-commit",
  verification: { command: "pnpm check", exitCode: 0, output: "all green" },
} as const;
const standards = {
  findings: [],
  kind: "standards",
  resultCommit: candidate.resultCommit,
  startCommit: candidate.startCommit,
  verdict: "passed",
} as const;
const fact = {
  category: "public_contract",
  evidence: {
    commit: candidate.resultCommit,
    kind: "code",
    line: 12,
    path: "src/outcome.ts",
    text: "export function projectTaskOutcomes()",
  },
  id: "F1",
  relevantTo: [target.id],
  statement: "Task Outcomes are derived from journal events.",
} as const;
const factDecision = {
  decision: "accepted",
  id: fact.id,
  reason: "The fact matches the implementation and route.",
} as const;
const discovery = {
  id: "A1",
  kind: "assumption",
  locator: {
    command: "pnpm check",
    exitCode: 0,
    kind: "verification",
    output: "all green",
  },
  reason: "The assumption was confirmed by verification.",
  state: "confirmed",
} as const;
const discoveryDecision = {
  decision: "accepted",
  id: discovery.id,
  kind: discovery.kind,
  reason: "The evidence supports the transition.",
} as const;
const passedPlanReview = {
  discoveryDecisions: [discoveryDecision],
  findings: [],
  kind: "plan_compliance",
  outcomeFactDecisions: [factDecision],
  resultCommit: candidate.resultCommit,
  startCommit: candidate.startCommit,
  verdict: "passed",
} as const;

function certifiedEvents(
  options: {
    readonly order?: readonly (typeof source)[];
    readonly runId?: string;
    readonly source?: typeof source;
    readonly target?: typeof source;
  } = {},
): readonly RunJournalEvent[] {
  const currentSource = options.source ?? source;
  const currentTarget = options.target ?? target;
  const runId = options.runId ?? "run-1";
  const currentFact = { ...fact, relevantTo: [currentTarget.id] };
  return [
    {
      runId,
      task: {
        identity: currentSource,
        instructions: "Build outcomes.",
        outcomeRoutes: [currentTarget],
        outcomeTaskOrder: options.order ?? [currentSource, currentTarget],
        title: "Build outcomes",
      },
      type: "task_selected",
    },
    {
      ...candidate,
      completion: { summary: "This must not enter the outcome." },
      runId,
      session: { id: "standards-review-session" },
      task: currentSource,
      type: "standards_review_started",
    },
    {
      result: standards,
      runId,
      session: { id: "standards-review-session" },
      task: currentSource,
      type: "standards_review_completed",
    },
    {
      ...candidate,
      completion: { summary: "This must not enter the outcome." },
      discoveries: [discovery],
      outcomeFacts: [currentFact],
      runId,
      session: { id: "plan-review-session" },
      standards,
      task: currentSource,
      type: "plan_compliance_review_started",
    },
    {
      result: passedPlanReview,
      runId,
      session: { id: "plan-review-session" },
      task: currentSource,
      type: "plan_compliance_review_completed",
    },
    {
      decision: discoveryDecision,
      proposal: discovery,
      runId,
      task: currentSource,
      transition: { id: "A1", kind: "assumption", state: "confirmed" },
      type: "ledger_transition_recorded",
    },
    {
      ...candidate,
      certification: "independent_reviews",
      completedAt: "2026-09-03T12:00:00.000Z",
      runId,
      session: { id: "implementation-session" },
      task: currentSource,
      type: "task_completed",
    },
  ];
}

function journalEvents(
  events: readonly RunJournalEvent[] = certifiedEvents(),
): readonly RunJournalEvent[] {
  const selected = events[0];
  if (selected?.type !== "task_selected") {
    throw new Error("Invalid selection fixture");
  }
  const runId = selected.runId;
  const currentSource = selected.task.identity;
  const request = {
    completedTasks: [],
    planId: "plan-1",
    runId,
    skills: [],
    taskSource: { location: "/repo/plan", type: "striker-plan" },
  } as const;
  return [
    { planId: request.planId, request, runId, type: "run_started" },
    selected,
    {
      before: {
        dirtyPaths: [],
        head: candidate.startCommit,
        root: "/repo",
        trackedPatch: "",
        untrackedHashes: {},
      },
      runId,
      task: currentSource,
      type: "task_baseline_recorded",
    },
    { attempt: 1, runId, task: currentSource, type: "task_attempt_started" },
    {
      attempt: 1,
      request: { instructions: "Build outcomes.", skills: [] },
      runId,
      session: { id: "implementation-session" },
      task: currentSource,
      type: "task_session_started",
    },
    ...events.slice(1),
  ];
}

function replayedOutcomes(events = journalEvents()) {
  return replayPlanJournal(events, "plan-1").taskOutcomes;
}

it("derives a certified Task Outcome without summaries or raw output", () => {
  expect(replayedOutcomes()).toEqual([
    {
      attempt: 1,
      changedPaths: ["src/outcome.ts"],
      facts: [
        {
          ...fact,
          relevantTo: [target],
        },
      ],
      resultCommit: "result-commit",
      runId: "run-1",
      source,
      transitions: [
        {
          id: "A1",
          kind: "assumption",
          relevantTo: [target],
          state: "confirmed",
        },
      ],
      verification: { command: "pnpm check", exitCode: 0 },
    },
  ]);
});

it("omits incomplete and mismatched task attempts", () => {
  const events = journalEvents();
  const completion = events.at(-1);
  if (completion?.type !== "task_completed") {
    throw new Error("Invalid completion fixture");
  }

  expect(replayedOutcomes(events.slice(0, -1))).toEqual([]);
  expect(() =>
    replayedOutcomes([
      ...events.slice(0, -1),
      { ...completion, attempt: completion.attempt + 1 },
    ]),
  ).toThrow("matching passed reviews");
});

it("requires matching passed standards evidence", () => {
  const events = journalEvents().filter(
    (event) => event.type !== "standards_review_completed",
  );

  expect(() => replayedOutcomes(events)).toThrow("invalid candidate evidence");
});

it("orders outcomes by the immutable manifest task order", () => {
  const third = { id: "tasks/03.md", revision: "third-revision" };
  const order = [source, target, third];
  const first = replayedOutcomes(journalEvents(certifiedEvents({ order })))[0];
  const second = replayedOutcomes(
    journalEvents(
      certifiedEvents({
        order,
        runId: "run-2",
        source: target,
        target: third,
      }),
    ),
  )[0];
  if (first === undefined || second === undefined) {
    throw new Error("Missing outcome fixture");
  }

  expect(
    orderTaskOutcomes([
      { outcome: second, sourceIndex: 1 },
      { outcome: first, sourceIndex: 0 },
    ]).map((outcome) => outcome.source),
  ).toEqual([source, target]);
});

it("orders accepted facts by numeric task-local ID", () => {
  const extraFacts = ["F10", "F2"].map((id) => ({ ...fact, id }));
  const events = journalEvents(
    certifiedEvents().map((event): RunJournalEvent => {
      if (event.type === "plan_compliance_review_started") {
        return { ...event, outcomeFacts: [...extraFacts, fact] };
      }
      if (event.type === "plan_compliance_review_completed") {
        return {
          ...event,
          result: {
            ...event.result,
            outcomeFactDecisions: [
              ...extraFacts.map((item) => ({ ...factDecision, id: item.id })),
              factDecision,
            ],
          },
        };
      }
      return event;
    }),
  );

  expect(replayedOutcomes(events)[0]?.facts.map((item) => item.id)).toEqual([
    "F1",
    "F2",
    "F10",
  ]);
});

it("omits rejected Outcome Facts from an otherwise certified outcome", () => {
  const events = journalEvents(
    certifiedEvents().map((event): RunJournalEvent =>
      event.type === "plan_compliance_review_completed"
        ? {
            ...event,
            result: {
              ...event.result,
              outcomeFactDecisions: [
                {
                  ...factDecision,
                  decision: "rejected",
                  reason: "The fact is not supported by its evidence.",
                },
              ],
            },
          }
        : event,
    ),
  );

  expect(replayedOutcomes(events)).toMatchObject([{ facts: [] }]);
});

it("rejects plan review for a different implementation result", () => {
  const events = journalEvents(
    certifiedEvents().map((event): RunJournalEvent =>
      event.type === "plan_compliance_review_started"
        ? { ...event, completion: { summary: "different result" } }
        : event,
    ),
  );

  expect(() => replayedOutcomes(events)).toThrow("invalid candidate evidence");
});

it("writes a deterministic Task Outcome projection envelope", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-outcomes-"));
  const planRoot = path.join(root, "plans", "plan-1");
  await mkdir(planRoot, { recursive: true });
  const events = journalEvents();
  const recovery = replayPlanJournal(events, "plan-1");

  await writePlanProjections(
    planRoot,
    "plan-1",
    recovery.snapshot,
    events,
    recovery.taskOutcomes,
  );

  expect(
    JSON.parse(
      await readFile(path.join(planRoot, "task-outcomes.json"), "utf8"),
    ),
  ).toEqual({
    outcomes: recovery.taskOutcomes,
    planId: "plan-1",
    schema: "striker.task-outcomes.v1",
  });
});
