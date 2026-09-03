import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { DispatchRequest, ImplementationTask } from "../core/contracts.js";
import type { ResolvedOutcomeFactProposal } from "../core/outcome-contracts.js";
import { appendPassedStandardsReview } from "../testing/fakes.js";
import { FileRunJournal } from "./file-run-journal.js";

const identity = { id: "tasks/05.md", revision: "revision-5" };
const outcomeTarget = { id: "tasks/06.md", revision: "revision-6" };
const task: ImplementationTask = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity,
  instructions: "Build review orchestration.",
  outcomeRoutes: [outcomeTarget],
  outcomeTaskOrder: [identity, outcomeTarget],
  title: "Review the candidate",
};
const request: DispatchRequest = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
};
const baseline = {
  dirtyPaths: [],
  head: "before",
  root: "/repo",
  trackedPatch: "",
  untrackedHashes: {},
};
const implementationCompletion = { summary: "implementation complete" };

async function startAttempt(journal: FileRunJournal): Promise<void> {
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: baseline,
    runId: request.runId,
    task: identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: task.instructions, skills: [] },
    runId: request.runId,
    session: { id: "implementor" },
    task: identity,
    type: "task_session_started",
  });
}

const passedStandards = {
  findings: [],
  kind: "standards",
  resultCommit: "after",
  startCommit: "before",
  verdict: "passed",
} as const;

async function preparePlanReviewJournal(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const journal = new FileRunJournal(root);
  await startAttempt(journal);
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  return journal;
}

const persistedFact = {
  category: "integration_boundary",
  evidence: {
    commit: "after",
    kind: "code",
    line: 1,
    path: "src/task.ts",
    text: "export const owner = core;",
  },
  id: "F1",
  relevantTo: ["tasks/06.md"],
  statement: "Core owns certification.",
} as const;

function planReviewStarted(
  outcomeFacts: readonly ResolvedOutcomeFactProposal[],
) {
  return {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    outcomeFacts,
    resultCommit: "after",
    runId: request.runId,
    session: { id: "plan-reviewer" },
    standards: passedStandards,
    startCommit: "before",
    task: identity,
    type: "plan_compliance_review_started" as const,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  };
}

function appendIndependentCompletion(journal: FileRunJournal): Promise<void> {
  return journal.append({
    attempt: 1,
    certification: "independent_reviews",
    changedPaths: ["src/task.ts"],
    completedAt: "2026-09-03T12:00:00.000Z",
    resultCommit: "after",
    runId: request.runId,
    session: { id: "implementor" },
    startCommit: "before",
    task: identity,
    type: "task_completed",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
}

it("reloads an interrupted standards review with its exact candidate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-review-journal-"));
  const journal = new FileRunJournal(root);
  await startAttempt(journal);
  await journal.append({
    attempt: 1,
    attention: {
      detail: "reviewer disconnected",
      reason: "standards_review_interrupted",
    },
    changedPaths: ["src/task.ts"],
    completion: { summary: "implementation complete" },
    resultCommit: "after",
    runId: request.runId,
    session: null,
    startCommit: "before",
    task: identity,
    type: "standards_review_interrupted",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });

  await expect(new FileRunJournal(root).loadActive()).resolves.toMatchObject({
    snapshot: {
      standardsReview: {
        completion: { summary: "implementation complete" },
        resultCommit: "after",
        stage: "interrupted",
      },
      status: "needs_attention",
    },
  });
});

it("rejects task completion without matching passed review evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-review-required-"));
  const journal = new FileRunJournal(root);
  await startAttempt(journal);

  await expect(
    journal.append({
      attempt: 1,
      certification: "standards_review",
      changedPaths: ["src/task.ts"],
      completedAt: "2026-08-23T00:00:00.000Z",
      resultCommit: "after",
      runId: request.runId,
      session: { id: "implementor" },
      startCommit: "before",
      task: identity,
      type: "task_completed",
      verification: { command: "pnpm check", exitCode: 0, output: "ok" },
    }),
  ).rejects.toThrow("passed standards review");
});

it("reloads an interrupted plan-compliance review after standards passed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-review-"));
  const journal = new FileRunJournal(root);
  await startAttempt(journal);
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  const outcomeFacts = [
    {
      category: "public_contract",
      evidence: {
        command: "pnpm check",
        exitCode: 0,
        kind: "verification",
        output: "ok",
      },
      id: "F1",
      relevantTo: ["tasks/06.md"],
      statement: "The review input is durable.",
    },
  ] as const;

  await journal.append({
    attempt: 1,
    attention: {
      detail: "plan reviewer disconnected",
      reason: "plan_compliance_review_interrupted",
    },
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    outcomeFacts,
    resultCommit: "after",
    runId: request.runId,
    session: null,
    standards: passedStandards,
    startCommit: "before",
    task: identity,
    type: "plan_compliance_review_interrupted",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });

  await expect(new FileRunJournal(root).loadActive()).resolves.toMatchObject({
    snapshot: {
      planComplianceReview: {
        outcomeFacts,
        resultCommit: "after",
        stage: "interrupted",
        standards: passedStandards,
      },
      standardsReview: { stage: "passed" },
      status: "needs_attention",
    },
  });
});

it("derives a certified Task Outcome from journal v6 review evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-outcome-review-"));
  const journal = new FileRunJournal(root);
  await startAttempt(journal);
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  const outcomeFacts = [
    {
      category: "integration_boundary",
      evidence: {
        commit: "after",
        kind: "code",
        line: 1,
        path: "src/task.ts",
        text: "export const owner = core;",
      },
      id: "F1",
      relevantTo: ["tasks/06.md"],
      statement: "Core owns certification.",
    },
  ] as const;
  await journal.append({
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: implementationCompletion,
    outcomeFacts,
    resultCommit: "after",
    runId: request.runId,
    session: { id: "plan-reviewer" },
    standards: passedStandards,
    startCommit: "before",
    task: identity,
    type: "plan_compliance_review_started",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  const outcomeFactDecisions = [
    { decision: "accepted", id: "F1", reason: "Supported by the route." },
  ] as const;
  await journal.append({
    result: {
      discoveryDecisions: [],
      findings: [],
      kind: "plan_compliance",
      outcomeFactDecisions,
      resultCommit: "after",
      startCommit: "before",
      verdict: "passed",
    },
    runId: request.runId,
    session: { id: "plan-reviewer" },
    task: identity,
    type: "plan_compliance_review_completed",
  });

  await appendIndependentCompletion(journal);

  await expect(new FileRunJournal(root).loadActive()).resolves.toMatchObject({
    snapshot: {
      planComplianceReview: null,
    },
    taskOutcomes: [
      {
        facts: [{ ...outcomeFacts[0], relevantTo: [outcomeTarget] }],
        source: identity,
        verification: { command: "pnpm check", exitCode: 0 },
      },
    ],
  });
});

it("rejects malformed resolved Outcome Facts in journal v6", async () => {
  const journal = await preparePlanReviewJournal("striker-invalid-outcome-");

  await expect(
    journal.append(planReviewStarted([{ ...persistedFact, id: "F0" }])),
  ).rejects.toThrow("Invalid Outcome Fact ID");
});

it("rejects mismatched Outcome Fact decisions during replay", async () => {
  const journal = await preparePlanReviewJournal("striker-outcome-decisions-");
  await journal.append(planReviewStarted([persistedFact]));

  await expect(
    journal.append({
      result: {
        discoveryDecisions: [],
        findings: [],
        kind: "plan_compliance",
        outcomeFactDecisions: [],
        resultCommit: "after",
        startCommit: "before",
        verdict: "passed",
      },
      runId: request.runId,
      session: { id: "plan-reviewer" },
      task: identity,
      type: "plan_compliance_review_completed",
    }),
  ).rejects.toThrow("decisions do not match Outcome Facts");
});
