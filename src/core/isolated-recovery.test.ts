import { expect, test } from "vitest";
import { runStandardsReview } from "./standards-review.js";
import { runPlanComplianceReview } from "./plan-compliance-review.js";
import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import type { AgentRunner, ReviewTurn } from "./contracts.js";

for (const kind of ["standards", "plan_compliance"] as const) {
  test(`${kind} resumes an isolated reviewer in its recorded session`, async () => {
    const session = {
      id: "review",
      resumeId: "backend",
      execution: {
        environmentId: "a".repeat(64),
        stageId: "cdd9e33b-5b67-48de-b0d6-f6cb3f6fef76",
        inputId: "b".repeat(64),
      },
    };
    const result = {
      kind,
      verdict: "passed" as const,
      startCommit: "start",
      resultCommit: "end",
      findings: [],
      discoveryDecisions: [],
      outcomeFactDecisions: [],
    };
    let resumed = false;
    const runner: AgentRunner = Object.assign(
      new FakeAgentRunner({
        status: "failed",
        session,
        error: "must not start implementation",
      }),
      {
        resumeReviewSession: (
          preserved: typeof session,
        ): Promise<ReviewTurn> => {
          expect(preserved).toEqual(session);
          resumed = true;
          return Promise.resolve({ status: "returned", session, result });
        },
      },
    );
    const input = reviewInput(runner, session, result);
    await seed(input, kind);
    const outcome = await (kind === "standards"
      ? runStandardsReview(input)
      : runPlanComplianceReview(input));
    expect(outcome.status).toBe("passed");
    expect(resumed).toBe(true);
  });
}

function reviewInput(
  runner: AgentRunner,
  session: import("./contracts.js").AgentSession,
  result: import("./contracts.js").ReviewResult,
) {
  return {
    attempt: 1,
    completion: { summary: "done" },
    execution: {
      before: {
        root: "/repo",
        head: "start",
        dirtyPaths: [],
        trackedPatch: "",
        untrackedHashes: {},
      },
      after: {
        root: "/repo",
        head: "end",
        dirtyPaths: [],
        trackedPatch: "",
        untrackedHashes: {},
      },
      changedPaths: [],
      commits: ["end"],
      verification: { command: "true", exitCode: 0, output: "" },
    },
    journal: new InMemoryRunJournal(),
    request: {
      planId: "plan",
      runId: "run",
      skills: [],
      completedTasks: [],
      taskSource: { type: "memory", location: "plan" },
    },
    runner,
    task: {
      identity: { id: "task", revision: "1" },
      title: "Task",
      instructions: "Frozen",
    },
    preservedSession: session,
    discoveries: [],
    outcomeFacts: [],
    standards: { ...result, kind: "standards" as const },
  };
}
async function seed(
  input: ReturnType<typeof reviewInput>,
  kind: "standards" | "plan_compliance",
) {
  await input.journal.append({
    type: "run_started",
    runId: "run",
    planId: "plan",
    request: input.request,
  });
  await input.journal.append({
    type: "task_selected",
    runId: "run",
    task: input.task,
  });
  await input.journal.append({
    type: "task_baseline_recorded",
    runId: "run",
    task: input.task.identity,
    before: input.execution.before,
  });
  await input.journal.append({
    type: "task_attempt_started",
    runId: "run",
    task: input.task.identity,
    attempt: 1,
  });
  await input.journal.append({
    type: "task_session_started",
    runId: "run",
    task: input.task.identity,
    attempt: 1,
    session: { id: "implement" },
    request: { instructions: "Frozen", skills: [] },
  });
  if (kind === "plan_compliance") {
    await input.journal.append({
      type: "standards_review_started",
      runId: "run",
      task: input.task.identity,
      attempt: 1,
      session: { id: "standards" },
      changedPaths: [],
      startCommit: "start",
      resultCommit: "end",
      completion: input.completion,
      verification: input.execution.verification,
    });
    await input.journal.append({
      type: "standards_review_completed",
      runId: "run",
      task: input.task.identity,
      session: { id: "standards" },
      result: input.standards,
    });
  }
}
