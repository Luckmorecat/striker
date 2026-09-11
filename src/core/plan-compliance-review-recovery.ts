import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  PlanComplianceReviewState,
  RunAttention,
  RunJournal,
  TaskExecutionEvidence,
} from "./contracts.js";
import {
  repairPlanComplianceFindings,
  runPlanComplianceReview,
} from "./plan-compliance-review.js";

interface PlanReviewRecoveryRequest {
  readonly before: GitState;
  readonly completeCandidate: (
    review: PlanComplianceReviewState,
  ) => Promise<DispatchResult>;
  readonly completeRepair: (
    output: string,
    rejectedCommit: string,
  ) => Promise<DispatchResult>;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly review: PlanComplianceReviewState;
  readonly runner: AgentRunner;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
  readonly validateCandidate: (
    review: PlanComplianceReviewState,
  ) => Promise<RunAttention | null>;
}

function attentionResult(
  input: PlanReviewRecoveryRequest,
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
  input: PlanReviewRecoveryRequest,
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
  input: PlanReviewRecoveryRequest,
): Promise<void> {
  await input.journal.append({
    attempt: input.review.attempt,
    attention: {
      detail:
        "The plan-compliance reviewer did not record a result before interruption.",
      reason: "plan_compliance_review_interrupted",
    },
    changedPaths: input.review.changedPaths,
    completion: input.review.completion,
    discoveries: input.review.discoveries ?? [],
    outcomeFacts: input.review.outcomeFacts ?? [],
    resultCommit: input.review.resultCommit,
    runId: input.request.runId,
    session: input.review.reviewSession,
    standards: input.review.standards,
    startCommit: input.review.startCommit,
    task: input.task.identity,
    type: "plan_compliance_review_interrupted",
    verification: input.review.verification,
  });
}

async function markInterruptedRepair(
  input: PlanReviewRecoveryRequest,
): Promise<void> {
  if (input.review.result === null) {
    throw new Error("Interrupted plan-compliance repair has no result");
  }
  await input.journal.append({
    attention: {
      detail: "The plan-compliance repair did not return before interruption.",
      reason: "plan_compliance_repair_interrupted",
    },
    result: input.review.result,
    runId: input.request.runId,
    session: input.review.repairSession ?? input.session,
    task: input.task.identity,
    type: "plan_compliance_repair_interrupted",
  });
}

async function repair(
  input: PlanReviewRecoveryRequest,
  result = input.review.result,
): Promise<DispatchResult> {
  if (result === null) {
    throw new Error("Plan-compliance repair has no review result");
  }
  const outcome = await repairPlanComplianceFindings({
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

async function review(
  input: PlanReviewRecoveryRequest,
): Promise<DispatchResult> {
  const outcome = await runPlanComplianceReview({
    preservedSession: input.review.reviewSession,
    attempt: input.review.attempt,
    completion: input.review.completion,
    discoveries: input.review.discoveries ?? [],
    execution: executionEvidence(input),
    journal: input.journal,
    outcomeFacts: input.review.outcomeFacts ?? [],
    request: input.request,
    runner: input.runner,
    standards: input.review.standards,
    task: input.task,
  });
  if (outcome.status === "interrupted") {
    return attentionResult(input, outcome.attention);
  }
  if (outcome.status === "changes_required") {
    return repair(input, outcome.result);
  }
  return completeCandidate(input, {
    ...input.review,
    result: outcome.result,
    stage: "passed",
  });
}

async function completeCandidate(
  input: PlanReviewRecoveryRequest,
  candidate: PlanComplianceReviewState,
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

export async function recoverPlanComplianceReview(
  input: PlanReviewRecoveryRequest,
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
        throw new Error("Completed plan-compliance repair has no output");
      }
      return input.completeRepair(
        input.review.repairOutput,
        input.review.resultCommit,
      );
    case "repair_attention":
      throw new Error("Repair attention must resume the implementor");
  }
}
