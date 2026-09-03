import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type {
  DispatchRequest,
  RunJournalEvent,
  RunSnapshot,
} from "../core/contracts.js";
import { FilePlanLogReader, writePlanProjections } from "./plan-projections.js";

const task = { id: "tasks/01.md", revision: "revision-1" };
const request: DispatchRequest = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
};
const proposal = {
  id: "A1",
  kind: "assumption",
  locator: {
    command: "pnpm check",
    exitCode: 0,
    kind: "verification",
    output: "all green",
  },
  reason: "The verification disproves the ownership assumption.",
  state: "disproved",
} as const;
const decision = {
  decision: "accepted",
  id: "A1",
  kind: "assumption",
  reason: "The stored verification matches the proposal.",
} as const;

function events(): readonly RunJournalEvent[] {
  const standards = {
    findings: [],
    kind: "standards" as const,
    resultCommit: "result-commit",
    startCommit: "start-commit",
    verdict: "passed" as const,
  };
  return [
    {
      attempt: 1,
      changedPaths: ["src/task.ts"],
      completion: { summary: "done" },
      discoveries: [proposal],
      resultCommit: "result-commit",
      runId: request.runId,
      session: { id: "plan-review" },
      standards,
      startCommit: "start-commit",
      task,
      type: "plan_compliance_review_started",
      verification: { command: "pnpm check", exitCode: 0, output: "all green" },
    },
    {
      result: {
        discoveryDecisions: [decision],
        findings: [],
        kind: "plan_compliance",
        outcomeFactDecisions: [],
        resultCommit: "result-commit",
        startCommit: "start-commit",
        verdict: "passed",
      },
      runId: request.runId,
      session: { id: "plan-review" },
      task,
      type: "plan_compliance_review_completed",
    },
    {
      decision,
      proposal,
      runId: request.runId,
      task,
      transition: { id: "A1", kind: "assumption", state: "disproved" },
      type: "ledger_transition_recorded",
    },
  ];
}

function completionEvent(
  completedTask: typeof task,
  completedAt: string,
): RunJournalEvent {
  return {
    attempt: 1,
    certification: "independent_reviews",
    changedPaths: ["src/task.ts"],
    completedAt,
    resultCommit: "result-commit",
    runId: request.runId,
    session: { id: "implementation" },
    startCommit: "start-commit",
    task: completedTask,
    type: "task_completed",
    verification: { command: "pnpm check", exitCode: 0, output: "all green" },
  };
}

it("logs discovery proposals, decisions, transitions, and pause reasons", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-discovery-log-"));
  const planRoot = path.join(root, "plans", request.planId);
  await mkdir(planRoot, { recursive: true });
  const snapshot: RunSnapshot = {
    attention: {
      detail: `${proposal.id}: ${decision.reason}`,
      reason: "assumption_disproved",
    },
    planId: request.planId,
    request,
    runId: request.runId,
    session: null,
    status: "needs_attention",
    task: null,
  };
  await writePlanProjections(planRoot, request.planId, snapshot, events());

  const log = await new FilePlanLogReader(root).read(request.planId);
  expect(log).toContain("### Discovery A1");
  expect(log).toContain("Review: accepted");
  expect(log).toContain("Transition: `recorded` -> `disproved`");
  expect(log).toContain("Pause: `assumption_disproved`");
});

it("does not attribute a later review transition to an earlier review", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-review-log-"));
  const planRoot = path.join(root, "plans", request.planId);
  await mkdir(planRoot, { recursive: true });
  const [started, completed, transition] = events();
  if (
    started?.type !== "plan_compliance_review_started" ||
    completed?.type !== "plan_compliance_review_completed" ||
    transition?.type !== "ledger_transition_recorded"
  ) {
    throw new Error("Invalid discovery test fixture");
  }
  const firstDecision = {
    ...decision,
    reason: "The candidate still has a blocking plan finding.",
  };
  const firstCompleted: RunJournalEvent = {
    ...completed,
    result: {
      ...completed.result,
      discoveryDecisions: [firstDecision],
      verdict: "changes_required",
    },
  };
  await writePlanProjections(planRoot, request.planId, {} as RunSnapshot, [
    started,
    firstCompleted,
    { ...started, session: { id: "plan-review-2" } },
    {
      ...completed,
      session: { id: "plan-review-2" },
    },
    transition,
  ]);

  const log = await new FilePlanLogReader(root).read(request.planId);
  const discoveries = log.split("### Discovery A1").slice(1);
  expect(discoveries).toHaveLength(2);
  expect(discoveries[0]).toContain("Transition: not applied.");
  expect(discoveries[0]).not.toContain("Pause:");
  expect(discoveries[1]).toContain("Transition: `recorded` -> `disproved`.");
  expect(discoveries[1]).toContain("Pause: `assumption_disproved`.");
});

it("keeps a task discovery ahead of later task completions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-ordered-log-"));
  const planRoot = path.join(root, "plans", request.planId);
  await mkdir(planRoot, { recursive: true });
  const secondTask = { id: "tasks/02.md", revision: "revision-2" };
  await writePlanProjections(planRoot, request.planId, {} as RunSnapshot, [
    ...events(),
    completionEvent(task, "2026-08-22T12:00:00.000Z"),
    completionEvent(secondTask, "2026-08-22T13:00:00.000Z"),
  ]);

  const log = await new FilePlanLogReader(root).read(request.planId);
  expect(log.indexOf("### Discovery A1")).toBeLessThan(
    log.indexOf("## tasks/02.md"),
  );
});
