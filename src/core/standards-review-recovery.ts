import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  RunAttention,
  RunJournal,
  StandardsReviewState,
  TaskExecutionEvidence,
} from "./contracts.js";
import {
  repairStandardsFindings,
  runStandardsReview,
} from "./standards-review.js";

interface ReviewRecoveryRequest {
  readonly before: GitState;
  readonly completeCandidate: (
    review: StandardsReviewState,
  ) => Promise<DispatchResult>;
  readonly completeRepair: (
    output: string,
    rejectedCommit: string,
  ) => Promise<DispatchResult>;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly review: StandardsReviewState;
  readonly runner: AgentRunner;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
  readonly validateCandidate: (
    review: StandardsReviewState,
  ) => Promise<RunAttention | null>;
}

function interruption(reason: RunAttention["reason"], detail: string) {
  return { detail, reason } as const;
}

function attentionResult(
  input: ReviewRecoveryRequest,
  attention: RunAttention,
): DispatchResult {
  return {
    reason: attention.reason,
    runId: input.request.runId,
    session: input.session,
    status: "needs_attention",
    task: input.task,
  };
}

function executionEvidence(
  input: ReviewRecoveryRequest,
): TaskExecutionEvidence {
  return {
    after: { ...input.before, head: input.review.resultCommit },
    before: input.before,
    changedPaths: input.review.changedPaths,
    commits: [input.review.resultCommit],
    verification: input.review.verification,
  };
}

async function markInterruptedReview(
  input: ReviewRecoveryRequest,
): Promise<void> {
  const attention = interruption(
    "standards_review_interrupted",
    "The standards reviewer did not record a result before interruption.",
  );
  await input.journal.append({
    attempt: input.review.attempt,
    attention,
    changedPaths: input.review.changedPaths,
    completion: input.review.completion,
    resultCommit: input.review.resultCommit,
    runId: input.request.runId,
    session: input.review.reviewSession,
    startCommit: input.review.startCommit,
    task: input.task.identity,
    type: "standards_review_interrupted",
    verification: input.review.verification,
  });
}

async function markInterruptedRepair(
  input: ReviewRecoveryRequest,
): Promise<void> {
  if (input.review.result === null) {
    throw new Error("Interrupted standards repair has no review result");
  }
  await input.journal.append({
    attention: interruption(
      "standards_repair_interrupted",
      "The implementation repair did not return before interruption.",
    ),
    result: input.review.result,
    runId: input.request.runId,
    session: input.session,
    task: input.task.identity,
    type: "standards_repair_interrupted",
  });
}

async function repair(
  input: ReviewRecoveryRequest,
  result = input.review.result,
): Promise<DispatchResult> {
  if (result === null) {
    throw new Error("Standards repair has no review result");
  }
  const outcome = await repairStandardsFindings({
    journal: input.journal,
    request: input.request,
    result,
    runner: input.runner,
    session: input.session,
    task: input.task,
  });
  return outcome.status === "interrupted"
    ? attentionResult(input, outcome.attention)
    : input.completeRepair(outcome.output, result.resultCommit);
}

async function review(input: ReviewRecoveryRequest): Promise<DispatchResult> {
  const outcome = await runStandardsReview({
    attempt: input.review.attempt,
    completion: input.review.completion,
    execution: executionEvidence(input),
    journal: input.journal,
    request: input.request,
    runner: input.runner,
    task: input.task,
  });
  if (outcome.status === "interrupted") {
    return attentionResult(input, outcome.attention);
  }
  if (outcome.status === "changes_required") {
    return repair(input, outcome.result);
  }
  return completeCandidate(input, input.review);
}

async function completeCandidate(
  input: ReviewRecoveryRequest,
  candidate: StandardsReviewState,
): Promise<DispatchResult> {
  const attention = await input.validateCandidate(candidate);
  if (attention === null) return input.completeCandidate(candidate);
  await input.journal.append({
    attention,
    runId: input.request.runId,
    session: input.session,
    task: input.task.identity,
    type: "run_needs_attention",
  });
  return attentionResult(input, attention);
}

export async function recoverStandardsReview(
  input: ReviewRecoveryRequest,
): Promise<DispatchResult> {
  switch (input.review.stage) {
    case "passed":
      return completeCandidate(input, input.review);
    case "reviewing":
      await markInterruptedReview(input);
      return review(input);
    case "interrupted":
      return review(input);
    case "changes_required":
      return repair(input);
    case "repairing":
      await markInterruptedRepair(input);
      return repair(input);
    case "repair_interrupted":
      return repair(input);
    case "repaired":
      if (input.review.repairOutput === null) {
        throw new Error("Completed standards repair has no output");
      }
      return input.completeRepair(
        input.review.repairOutput,
        input.review.resultCommit,
      );
    case "repair_attention":
      throw new Error(
        "Repair attention must resume the implementation session",
      );
  }
}
