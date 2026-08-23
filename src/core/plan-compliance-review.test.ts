import { describe, expect, it } from "vitest";

import {
  appendPassedStandardsReview,
  FakeAgentRunner,
  InMemoryRunJournal,
} from "../testing/fakes.js";
import type {
  AgentSession,
  PlanComplianceReviewResult,
  ReviewTurn,
  StandardsReviewResult,
  TaskExecutionEvidence,
} from "./contracts.js";
import {
  repairPlanComplianceFindings,
  runPlanComplianceReview,
} from "./plan-compliance-review.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity: { id: "tasks/06.md", revision: "revision-6" },
  instructions:
    "# Review the plan\n\n## Build\n\nAdd plan review.\n\n## Paths\n\n- Create `src/task.ts`\n\n## Test contract\n\n- Test the public review boundary.\n\n## Verify\n\n```sh\npnpm check\n```\n\n## Striker plan context\n\nSpine: /plan/spine.md\nMap: /plan/map.md\n",
  title: "Review the plan",
} as const;
const request = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/plan", type: "striker-plan" },
} as const;
const implementor = { id: "implementor", resumeId: "provider-implementor" };
const execution: TaskExecutionEvidence = {
  after: {
    dirtyPaths: [],
    head: "candidate",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  },
  before: {
    dirtyPaths: [],
    head: "baseline",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  },
  changedPaths: ["src/task.ts"],
  commits: ["candidate"],
  verification: { command: "pnpm check", exitCode: 0, output: "ok" },
};
const standards: StandardsReviewResult = {
  findings: [],
  kind: "standards",
  resultCommit: "candidate",
  startCommit: "baseline",
  verdict: "passed",
};

function result(
  overrides: Partial<PlanComplianceReviewResult> = {},
): PlanComplianceReviewResult {
  return {
    findings: [],
    kind: "plan_compliance",
    resultCommit: "candidate",
    startCommit: "baseline",
    verdict: "passed",
    ...overrides,
  };
}

async function startedJournal(): Promise<InMemoryRunJournal> {
  const journal = new InMemoryRunJournal();
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: execution.before,
    runId: request.runId,
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    session: implementor,
    task: task.identity,
    type: "task_session_started",
  });
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: execution.changedPaths,
    resultCommit: execution.after.head,
    runId: request.runId,
    startCommit: execution.before.head,
    task: task.identity,
    verification: execution.verification,
  });
  return journal;
}

class ReviewRunner extends FakeAgentRunner {
  reviewInstructions = "";

  constructor(private readonly turn: ReviewTurn) {
    super({ output: "unused", session: implementor, status: "returned" });
  }

  override async runReviewInNewSession(
    reviewRequest: { readonly instructions: string },
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<ReviewTurn> {
    this.reviewInstructions = reviewRequest.instructions;
    await sessionStarted?.(this.turn.session);
    return this.turn;
  }
}

async function reviewWith(turn: ReviewTurn) {
  const journal = await startedJournal();
  const runner = new ReviewRunner(turn);
  const outcome = await runPlanComplianceReview({
    attempt: 1,
    completion: { summary: "implementation complete" },
    execution,
    journal,
    request,
    runner,
    standards,
    task,
  });
  return { journal, outcome, runner };
}

describe("runPlanComplianceReview", () => {
  it("records a fresh exact-commit review with the task and plan context", async () => {
    const reviewSession = { id: "plan-reviewer" };
    const test = await reviewWith({
      result: result(),
      session: reviewSession,
      status: "returned",
    });

    expect(test.outcome).toEqual({ result: result(), status: "passed" });
    expect(test.runner.reviewInstructions).toContain("## Test contract");
    expect(test.runner.reviewInstructions).toContain("/plan/spine.md");
    expect(test.runner.reviewInstructions).toContain('"kind": "standards"');
    expect(test.journal.events.slice(-2)).toEqual([
      expect.objectContaining({
        resultCommit: "candidate",
        standards,
        type: "plan_compliance_review_started",
      }),
      expect.objectContaining({
        result: result(),
        type: "plan_compliance_review_completed",
      }),
    ]);
  });

  it("interrupts results that name different commits or unchanged paths", async () => {
    const test = await reviewWith({
      result: result({
        findings: [
          {
            fix: "Remove the unrelated change.",
            kind: "plan_violation",
            location: { line: 1 },
            message: "The task does not authorize this file.",
            path: "src/other.ts",
            rule: "Task Paths",
            severity: "blocking",
          },
        ],
        resultCommit: "replacement",
        verdict: "changes_required",
      }),
      session: { id: "plan-reviewer" },
      status: "returned",
    });

    expect(test.outcome).toMatchObject({
      attention: { reason: "plan_compliance_review_interrupted" },
      status: "interrupted",
    });
  });
});

describe("repairPlanComplianceFindings", () => {
  it("resumes the preserved implementor and records the repair", async () => {
    const journal = await startedJournal();
    const finding = {
      fix: "Add the missing recovery test.",
      kind: "plan_violation",
      location: { line: 10 },
      message: "The recovery requirement is missing.",
      path: "src/task.ts",
      rule: "Task Build",
      severity: "blocking",
    } as const;
    const reviewResult = result({
      findings: [finding],
      verdict: "changes_required",
    });
    const reviewer = { id: "plan-reviewer" };
    await journal.append({
      attempt: 1,
      changedPaths: execution.changedPaths,
      completion: { summary: "implementation complete" },
      resultCommit: execution.after.head,
      runId: request.runId,
      session: reviewer,
      standards,
      startCommit: execution.before.head,
      task: task.identity,
      type: "plan_compliance_review_started",
      verification: execution.verification,
    });
    await journal.append({
      result: reviewResult,
      runId: request.runId,
      session: reviewer,
      task: task.identity,
      type: "plan_compliance_review_completed",
    });
    const runner = new FakeAgentRunner({
      output: '{"kind":"implementation","summary":"Repaired recovery."}',
      session: implementor,
      status: "returned",
    });

    const outcome = await repairPlanComplianceFindings({
      journal,
      request,
      result: reviewResult,
      runner,
      session: implementor,
      task,
    });

    expect(outcome.status).toBe("returned");
    expect(runner.resumeRequests[0]?.instructions).toContain(
      "plan-compliance review findings",
    );
    expect(journal.events.slice(-2).map((event) => event.type)).toEqual([
      "plan_compliance_repair_started",
      "plan_compliance_repair_completed",
    ]);
  });
});
