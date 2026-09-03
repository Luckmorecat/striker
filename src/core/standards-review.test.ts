import { describe, expect, it } from "vitest";

import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import type {
  AgentRunner,
  AgentSession,
  StandardsReviewResult,
  ReviewTurn,
  TaskExecutionEvidence,
} from "./contracts.js";
import { runStandardsReview } from "./standards-review.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity: { id: "tasks/05.md", revision: "revision-5" },
  instructions: "Build review orchestration.",
  title: "Review the candidate",
} as const;
const request = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
} as const;
const session = { id: "implementor", resumeId: "provider-implementor" };
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

function result(
  overrides: Partial<StandardsReviewResult> = {},
): StandardsReviewResult {
  return {
    findings: [],
    kind: "standards",
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
    request: { instructions: task.instructions, skills: [] },
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  return journal;
}

class ReviewRunner extends FakeAgentRunner {
  reviewInstructions = "";

  constructor(private readonly reviewTurn: ReviewTurn) {
    super({ output: "unused", session, status: "returned" });
  }

  override async runReviewInNewSession(
    reviewRequest: { readonly instructions: string },
    sessionStarted?: (reviewSession: AgentSession) => Promise<void>,
  ): Promise<ReviewTurn> {
    this.reviewInstructions = reviewRequest.instructions;
    await sessionStarted?.(this.reviewTurn.session);
    return this.reviewTurn;
  }
}

async function reviewWith(reviewTurn: ReviewTurn): Promise<{
  readonly journal: InMemoryRunJournal;
  readonly outcome: Awaited<ReturnType<typeof runStandardsReview>>;
  readonly runner: ReviewRunner;
}> {
  const journal = await startedJournal();
  const runner = new ReviewRunner(reviewTurn);
  const outcome = await runStandardsReview({
    attempt: 1,
    completion: { summary: "implementation complete" },
    execution,
    journal,
    request,
    runner,
    task,
  });
  return { journal, outcome, runner };
}

describe("runStandardsReview", () => {
  it("records a fresh review session and exact passed result", async () => {
    const reviewSession = { id: "reviewer" };
    const test = await reviewWith({
      result: result(),
      session: reviewSession,
      status: "returned",
    });

    expect(test.outcome).toEqual({ result: result(), status: "passed" });
    expect(test.runner.reviewInstructions).toContain("tasks/05.md");
    expect(test.runner.reviewInstructions).toContain("src/task.ts");
    expect(test.journal.events.slice(-2)).toEqual([
      expect.objectContaining({
        resultCommit: "candidate",
        session: reviewSession,
        startCommit: "baseline",
        type: "standards_review_started",
      }),
      expect.objectContaining({
        result: result(),
        session: reviewSession,
        type: "standards_review_completed",
      }),
    ]);
  });

  it("returns typed blocking findings for repair", async () => {
    const finding = {
      fix: "Split the function.",
      kind: "rule_violation",
      location: { line: 10 },
      message: "The function exceeds the limit.",
      path: "src/task.ts",
      rule: "Functions must stay within 80 logical lines.",
      severity: "blocking",
    } as const;
    const reviewResult = result({
      findings: [finding],
      verdict: "changes_required",
    });
    const test = await reviewWith({
      result: reviewResult,
      session: { id: "reviewer" },
      status: "returned",
    });

    expect(test.outcome).toEqual({
      result: reviewResult,
      status: "changes_required",
    });
  });
});

describe("standards review interruptions", () => {
  it("interrupts a review whose commit or finding path is not pinned", async () => {
    const test = await reviewWith({
      result: result({
        findings: [
          {
            fix: "Fix it.",
            kind: "defect",
            location: { line: 1 },
            message: "Wrong file.",
            path: "src/other.ts",
            rule: "correctness",
            severity: "blocking",
          },
        ],
        resultCommit: "replacement",
        verdict: "changes_required",
      }),
      session: { id: "reviewer" },
      status: "returned",
    });

    expect(test.outcome).toMatchObject({
      attention: { reason: "standards_review_interrupted" },
      status: "interrupted",
    });
    expect(test.journal.events.at(-1)).toMatchObject({
      type: "standards_review_interrupted",
    });
  });

  it("records a failed reviewer turn as recoverable interruption", async () => {
    const test = await reviewWith({
      error: "reviewer disconnected",
      session: { id: "reviewer" },
      status: "failed",
    });

    expect(test.outcome).toMatchObject({
      attention: { detail: "reviewer disconnected" },
      status: "interrupted",
    });
  });

  it("records review initialization failure without a review session", async () => {
    const journal = await startedJournal();
    const runner: AgentRunner = new FakeAgentRunner({
      output: "unused",
      session,
      status: "returned",
    });
    runner.runReviewInNewSession = () =>
      Promise.reject(new Error("review runtime unavailable"));

    const outcome = await runStandardsReview({
      attempt: 1,
      completion: { summary: "implementation complete" },
      execution,
      journal,
      request,
      runner,
      task,
    });

    expect(outcome).toMatchObject({ status: "interrupted" });
    expect(journal.events.at(-1)).toMatchObject({
      session: null,
      type: "standards_review_interrupted",
    });
  });
});
