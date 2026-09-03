import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type {
  DispatchRequest,
  RunJournal,
  RunSnapshot,
} from "../core/contracts.js";
import { reconcileReviewedDiscoveries } from "../core/discovery-reconciliation.js";
import { appendPassedStandardsReview } from "../testing/fakes.js";
import { FileRunJournal } from "./file-run-journal.js";
import { replayLedgerEvent } from "./run-journal-ledger-replay.js";

const identity = { id: "tasks/01.md", revision: "revision-1" };
const task = {
  identity,
  instructions: "Build.",
  title: "Build",
};
const request: DispatchRequest = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
};
const session = { id: "session-1" };
const secondIdentity = { id: "tasks/02.md", revision: "revision-2" };
const secondTask = { ...task, identity: secondIdentity, title: "Second" };
const verification = { command: "pnpm check", exitCode: 0, output: "ok" };
const proposal = {
  id: "A1",
  kind: "assumption",
  locator: {
    commit: "after",
    kind: "code",
    line: 1,
    path: "src/task.ts",
    text: "export const owner = core;",
  },
  reason: "The implementation contradicts the assumption.",
  state: "disproved",
} as const;
const decision = {
  decision: "accepted",
  id: "A1",
  kind: "assumption",
  reason: "The exact candidate line supports the proposal.",
} as const;

async function appendAttempt(journal: RunJournal): Promise<void> {
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: {
      dirtyPaths: [],
      head: "before",
      root: "/repo",
      trackedPatch: "",
      untrackedHashes: {},
    },
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
    session,
    task: identity,
    type: "task_session_started",
  });
}

async function appendReviews(journal: RunJournal): Promise<void> {
  const standards = {
    findings: [],
    kind: "standards" as const,
    resultCommit: "after",
    startCommit: "before",
    verdict: "passed" as const,
  };
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification,
  });
  await journal.append({
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: { summary: "done" },
    discoveries: [proposal],
    resultCommit: "after",
    runId: request.runId,
    session: { id: "plan-review" },
    standards,
    startCommit: "before",
    task: identity,
    type: "plan_compliance_review_started",
    verification,
  });
  await journal.append({
    result: {
      discoveryDecisions: [decision],
      findings: [],
      kind: "plan_compliance",
      resultCommit: "after",
      startCommit: "before",
      verdict: "passed",
    },
    runId: request.runId,
    session: { id: "plan-review" },
    task: identity,
    type: "plan_compliance_review_completed",
  });
}

async function appendTransitionAndCompletion(journal: RunJournal) {
  await journal.append({
    decision,
    proposal,
    runId: request.runId,
    task: identity,
    transition: { id: "A1", kind: "assumption", state: "disproved" },
    type: "ledger_transition_recorded",
  });
  await journal.append({
    attempt: 1,
    certification: "independent_reviews",
    changedPaths: ["src/task.ts"],
    completedAt: "2026-08-22T12:00:00.000Z",
    resultCommit: "after",
    runId: request.runId,
    session,
    startCommit: "before",
    task: identity,
    type: "task_completed",
    verification,
  });
}

it("replays a reviewed ledger transition and its completed-task pause", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-journal-ledger-"));
  const journal = new FileRunJournal(root);
  await appendAttempt(journal);
  await appendReviews(journal);
  await appendTransitionAndCompletion(journal);

  await expect(journal.loadActive()).resolves.toMatchObject({
    completedTasks: [identity],
    ledgerTransitions: [{ transition: { id: "A1", state: "disproved" } }],
    snapshot: {
      attention: { reason: "assumption_disproved" },
      status: "needs_attention",
      task: null,
    },
  });
});

async function closePausedRun(journal: RunJournal): Promise<void> {
  await journal.append({
    answer: "Continue with the recorded disproof.",
    runId: request.runId,
    type: "ledger_attention_answered",
  });
  await journal.append({ runId: request.runId, type: "run_completed" });
}

async function appendRepeatedAttempt(journal: RunJournal): Promise<void> {
  const runId = "run-2";
  const nextRequest = {
    ...request,
    completedTasks: [identity],
    runId,
  };
  await journal.append({
    planId: request.planId,
    request: nextRequest,
    runId,
    type: "run_started",
  });
  await journal.append({ runId, task: secondTask, type: "task_selected" });
  await journal.append({
    before: {
      dirtyPaths: [],
      head: "before-2",
      root: "/repo",
      trackedPatch: "",
      untrackedHashes: {},
    },
    runId,
    task: secondIdentity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId,
    task: secondIdentity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: secondTask.instructions, skills: [] },
    runId,
    session,
    task: secondIdentity,
    type: "task_session_started",
  });
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    resultCommit: "after-2",
    runId,
    startCommit: "before-2",
    task: secondIdentity,
    verification,
  });
}

async function appendRepeatedReview(journal: RunJournal): Promise<void> {
  const runId = "run-2";
  const standards = {
    findings: [],
    kind: "standards" as const,
    resultCommit: "after-2",
    startCommit: "before-2",
    verdict: "passed" as const,
  };
  await journal.append({
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: { summary: "done again" },
    discoveries: [proposal],
    resultCommit: "after-2",
    runId,
    session: { id: "plan-review-2" },
    standards,
    startCommit: "before-2",
    task: secondIdentity,
    type: "plan_compliance_review_started",
    verification,
  });
  await journal.append({
    result: {
      discoveryDecisions: [decision],
      findings: [],
      kind: "plan_compliance",
      resultCommit: "after-2",
      startCommit: "before-2",
      verdict: "passed",
    },
    runId,
    session: { id: "plan-review-2" },
    task: secondIdentity,
    type: "plan_compliance_review_completed",
  });
  await journal.append({
    decision,
    proposal,
    runId,
    task: secondIdentity,
    transition: { id: "A1", kind: "assumption", state: "disproved" },
    type: "ledger_transition_recorded",
  });
}

async function appendRepeatedCompletion(journal: RunJournal): Promise<void> {
  const runId = "run-2";
  await journal.append({
    attempt: 1,
    certification: "independent_reviews",
    changedPaths: ["src/task.ts"],
    completedAt: "2026-08-22T13:00:00.000Z",
    resultCommit: "after-2",
    runId,
    session,
    startCommit: "before-2",
    task: secondIdentity,
    type: "task_completed",
    verification,
  });
  await journal.append({ runId, type: "run_completed" });
}

async function appendRepeatedTransitionRun(journal: RunJournal): Promise<void> {
  await appendRepeatedAttempt(journal);
  await appendRepeatedReview(journal);
  await appendRepeatedCompletion(journal);
}

it("does not recreate attention when replay sees a repeated transition", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-repeat-ledger-"));
  const journal = new FileRunJournal(root);
  await appendAttempt(journal);
  await appendReviews(journal);
  await appendTransitionAndCompletion(journal);
  await closePausedRun(journal);
  await appendRepeatedTransitionRun(journal);

  await expect(journal.load(request.planId)).resolves.toMatchObject({
    discoveryReviews: [
      { applied: true },
      { applied: false, transition: { id: "A1" } },
    ],
    snapshot: { attention: null, status: "completed" },
  });
});

it("does not recover attention from a repeated transition crash", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-repeat-crash-"));
  const journal = new FileRunJournal(root);
  await appendAttempt(journal);
  await appendReviews(journal);
  await appendTransitionAndCompletion(journal);
  await closePausedRun(journal);
  await appendRepeatedAttempt(journal);
  await appendRepeatedReview(journal);

  await expect(
    reconcileReviewedDiscoveries(
      journal,
      request.planId,
      "run-2",
      secondIdentity,
      [proposal],
      {
        discoveryDecisions: [decision],
        findings: [],
        kind: "plan_compliance",
        resultCommit: "after-2",
        startCommit: "before-2",
        verdict: "passed",
      },
    ),
  ).resolves.toBeNull();
  await expect(journal.loadActive()).resolves.toMatchObject({
    snapshot: { attention: null, status: "running", task: secondTask },
  });
});

it("rejects a transition cross-paired with another proposal's decision", () => {
  const secondDecision = { ...decision, id: "A2", reason: "A2 accepted." };
  const secondProposal = { ...proposal, id: "A2", reason: "A2 disproved." };
  const standards = {
    findings: [],
    kind: "standards" as const,
    resultCommit: "after",
    startCommit: "before",
    verdict: "passed" as const,
  };
  const snapshot: RunSnapshot = {
    attempt: 1,
    before: {
      dirtyPaths: [],
      head: "before",
      root: "/repo",
      trackedPatch: "",
      untrackedHashes: {},
    },
    planComplianceReview: {
      attempt: 1,
      changedPaths: ["src/task.ts"],
      completion: { summary: "done" },
      discoveries: [proposal, secondProposal],
      repairOutput: null,
      result: {
        discoveryDecisions: [decision, secondDecision],
        findings: [],
        kind: "plan_compliance",
        resultCommit: "after",
        startCommit: "before",
        verdict: "passed",
      },
      resultCommit: "after",
      reviewSession: { id: "plan-review" },
      stage: "passed",
      standards,
      startCommit: "before",
      verification,
    },
    planId: request.planId,
    request,
    runId: request.runId,
    session,
    standardsReview: null,
    status: "running",
    task,
  };

  expect(() =>
    replayLedgerEvent(snapshot, {
      decision: secondDecision,
      proposal,
      runId: request.runId,
      task: identity,
      transition: { id: "A1", kind: "assumption", state: "disproved" },
      type: "ledger_transition_recorded",
    }),
  ).toThrow("Ledger transition lacks accepted review evidence");
});
