import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitRepository,
  PlanComplianceReviewState,
  RunJournal,
  RunSnapshot,
} from "./contracts.js";
import { reviewedCandidateAttention } from "./dispatch-evidence.js";
import { recoverPlanComplianceReview } from "./plan-compliance-review-recovery.js";
import {
  recoverableSnapshot,
  type RecoverableRun,
} from "./recovery-context.js";

interface PausedPlanReviewInput {
  readonly checkCompletion: (
    run: RecoverableRun,
    session: AgentSession,
    output: string,
    rejectedCommit: string,
  ) => Promise<DispatchResult>;
  readonly completeReviewed: (
    request: DispatchRequest,
    task: NonNullable<RunSnapshot["task"]>,
    session: AgentSession,
    review: PlanComplianceReviewState,
  ) => Promise<DispatchResult>;
  readonly continueRun: (request: DispatchRequest) => Promise<DispatchResult>;
  readonly dependencies: {
    readonly git?: GitRepository;
    readonly journal: RunJournal;
    readonly runner: AgentRunner;
  };
  readonly snapshot: RunSnapshot;
}

export function resumePlanReview(
  input: PausedPlanReviewInput,
): Promise<DispatchResult> {
  const {
    planComplianceReview: review,
    task,
    session,
    before,
  } = input.snapshot;
  if (review == null || task === null || session === null || before == null) {
    throw new Error("Plan-compliance review is missing recovery context");
  }
  const run = recoverableSnapshot(input.snapshot, [
    "needs_attention",
    "running",
  ]);
  return recoverPlanComplianceReview({
    before,
    completeCandidate: async (candidate) => {
      const result = await input.completeReviewed(
        input.snapshot.request,
        task,
        session,
        candidate,
      );
      const continued = await input.continueRun(input.snapshot.request);
      return continued.status === "source_exhausted" ? result : continued;
    },
    completeRepair: (output, rejectedCommit) =>
      input.checkCompletion(run, session, output, rejectedCommit),
    journal: input.dependencies.journal,
    request: input.snapshot.request,
    review,
    runner: input.dependencies.runner,
    session,
    task,
    validateCandidate: (candidate) =>
      reviewedCandidateAttention(input.dependencies, task, before, candidate),
  });
}
