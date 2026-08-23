import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { DispatchRequest, ImplementationTask } from "../core/contracts.js";
import { appendPassedStandardsReview } from "../testing/fakes.js";
import { FileRunJournal } from "./file-run-journal.js";

const identity = { id: "tasks/05.md", revision: "revision-5" };
const task: ImplementationTask = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity,
  instructions: "Build review orchestration.",
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
    runId: request.runId,
    session: { id: "implementor" },
    task: identity,
    type: "task_session_started",
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
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  const standards = {
    findings: [],
    kind: "standards",
    resultCommit: "after",
    startCommit: "before",
    verdict: "passed",
  } as const;

  await journal.append({
    attempt: 1,
    attention: {
      detail: "plan reviewer disconnected",
      reason: "plan_compliance_review_interrupted",
    },
    changedPaths: ["src/task.ts"],
    completion: { summary: "implementation complete" },
    resultCommit: "after",
    runId: request.runId,
    session: null,
    standards,
    startCommit: "before",
    task: identity,
    type: "plan_compliance_review_interrupted",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });

  await expect(new FileRunJournal(root).loadActive()).resolves.toMatchObject({
    snapshot: {
      planComplianceReview: {
        resultCommit: "after",
        stage: "interrupted",
        standards,
      },
      standardsReview: { stage: "passed" },
      status: "needs_attention",
    },
  });
});
