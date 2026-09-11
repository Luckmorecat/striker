import { expect, test } from "vitest";
import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import { repairStandardsFindings } from "./standards-review.js";
import type {
  AgentSession,
  RunJournalEvent,
  StandardsReviewResult,
} from "./contracts.js";

const session: AgentSession = {
  id: "implementation",
  execution: {
    environmentId: "a".repeat(64),
    inputId: "b".repeat(64),
    stageId: "cdd9e33b-5b67-48de-b0d6-f6cb3f6fef76",
  },
};
const task = {
  identity: { id: "task", revision: "1" },
  title: "Build task",
  instructions: "Complete the approved task",
  execution: {
    cwd: "/repo",
    affectedPaths: ["result"],
    verifyCommand: "test -f result",
    workflowInstructions: "Frozen workflow",
  },
};
const request = {
  runId: "run",
  planId: "plan",
  completedTasks: [],
  skills: ["chosen"],
  taskSource: { type: "memory", location: "plan" },
};
const review: StandardsReviewResult = {
  kind: "standards",
  verdict: "changes_required",
  startCommit: "start",
  resultCommit: "candidate",
  findings: [
    {
      kind: "defect",
      severity: "blocking",
      path: "result",
      location: { line: 1 },
      rule: "task",
      message: "Fix the output",
      fix: "Use the required output",
    },
  ],
};
async function readyJournal() {
  const journal = new InMemoryRunJournal();
  const events: RunJournalEvent[] = [
    { type: "run_started", runId: "run", planId: "plan", request },
    { type: "task_selected", runId: "run", task },
    {
      type: "task_baseline_recorded",
      runId: "run",
      task: task.identity,
      before: {
        root: "/repo",
        head: "start",
        dirtyPaths: [],
        trackedPatch: "",
        untrackedHashes: {},
      },
    },
    {
      type: "task_attempt_started",
      runId: "run",
      task: task.identity,
      attempt: 1,
    },
    {
      type: "task_session_started",
      runId: "run",
      task: task.identity,
      attempt: 1,
      session,
      request: {
        instructions: "Frozen task and plan",
        workflowInstructions: "Frozen workflow",
        skills: ["chosen"],
      },
    },
    {
      type: "standards_review_started",
      runId: "run",
      task: task.identity,
      attempt: 1,
      session: { id: "review" },
      changedPaths: ["result"],
      startCommit: "start",
      resultCommit: "candidate",
      completion: { summary: "done" },
      verification: { command: "test -f result", exitCode: 0, output: "" },
    },
    {
      type: "standards_review_completed",
      runId: "run",
      task: task.identity,
      session: { id: "review" },
      result: review,
    },
  ];
  for (const event of events) await journal.append(event);
  return journal;
}
test("isolated repair starts a fresh durable thread with frozen task context and review evidence", async () => {
  const journal = await readyJournal();
  const repairSession = { ...session, id: "fresh-repair" };
  const runner = new FakeAgentRunner({
    status: "returned",
    session: repairSession,
    output: "repaired",
  });
  expect(
    await repairStandardsFindings({
      journal,
      request,
      result: review,
      runner,
      session,
      task,
    }),
  ).toEqual({ status: "returned", output: "repaired" });
  expect(runner.resumeRequests).toHaveLength(0);
  expect(runner.requests[0]).toMatchObject({
    workflowInstructions: "Frozen workflow",
    skills: ["chosen"],
  });
  expect(runner.requests[0]?.instructions).toContain("Frozen task and plan");
  expect(runner.requests[0]?.instructions).toContain("Use the required output");
  expect((await journal.load("plan"))?.snapshot?.standardsReview).toMatchObject(
    { repairSession, stage: "repaired" },
  );
});

test("interrupted isolated repair resumes its recorded repair thread and frozen context", async () => {
  const journal = await readyJournal();
  const repairSession = { ...session, id: "preserved-repair" };
  const first = new FakeAgentRunner({
    status: "failed",
    session: repairSession,
    error: "worker killed",
  });
  expect(
    await repairStandardsFindings({
      journal,
      request,
      result: review,
      runner: first,
      session,
      task,
    }),
  ).toMatchObject({ status: "interrupted" });
  const next = new FakeAgentRunner({
    status: "returned",
    session: repairSession,
    output: "repaired",
  });
  expect(
    await repairStandardsFindings({
      journal,
      request,
      result: review,
      runner: next,
      session,
      task,
    }),
  ).toMatchObject({ status: "returned" });
  expect(next.requests).toHaveLength(0);
  expect(next.resumeRequests).toMatchObject([{ session: repairSession }]);
});
