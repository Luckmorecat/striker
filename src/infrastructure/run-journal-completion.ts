import { isDeepStrictEqual } from "node:util";

import type { RunJournalEvent, RunSnapshot } from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

export function matchesCompletion(
  review: RunSnapshot["planComplianceReview"] | RunSnapshot["standardsReview"],
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): boolean {
  if (review?.stage !== "passed") return false;
  return isDeepStrictEqual(
    {
      attempt: review.attempt,
      changedPaths: review.changedPaths,
      resultCommit: review.resultCommit,
      startCommit: review.startCommit,
      verification: review.verification,
    },
    {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      resultCommit: event.resultCommit,
      startCommit: event.startCommit,
      verification: event.verification,
    },
  );
}

export function matchesPlanReviewCandidate(
  standards: RunSnapshot["standardsReview"],
  event: Extract<
    RunJournalEvent,
    {
      type:
        "plan_compliance_review_interrupted" | "plan_compliance_review_started";
    }
  >,
): boolean {
  if (standards?.stage !== "passed") return false;
  return isDeepStrictEqual(
    {
      attempt: standards.attempt,
      changedPaths: standards.changedPaths,
      completion: standards.completion,
      result: standards.result,
      resultCommit: standards.resultCommit,
      startCommit: standards.startCommit,
      verification: standards.verification,
    },
    {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      completion: event.completion,
      result: event.standards,
      resultCommit: event.resultCommit,
      startCommit: event.startCommit,
      verification: event.verification,
    },
  );
}

export function matchesIndependentCompletion(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): boolean {
  return (
    event.certification === "independent_reviews" &&
    matchesCompletion(snapshot.standardsReview, event) &&
    matchesCompletion(snapshot.planComplianceReview, event) &&
    isDeepStrictEqual(
      snapshot.standardsReview?.completion,
      snapshot.planComplianceReview?.completion,
    )
  );
}

export function completeTask(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): RunSnapshot {
  if (
    snapshot.status === "needs_attention" &&
    snapshot.attention?.reason !== "assumption_disproved" &&
    snapshot.attention?.reason !== "assumption_needs_decision"
  ) {
    throw new Error("Only a discovery pause can complete its reviewed task");
  }
  const status = transitionRun(snapshot.status, "complete_task");
  const attention = snapshot.attention ?? null;
  const standards = snapshot.standardsReview;
  if (
    event.certification === "standards_review" &&
    !matchesCompletion(standards, event)
  ) {
    throw new Error(
      "Task completion requires matching passed standards review",
    );
  }
  if (
    event.certification === "independent_reviews" &&
    !matchesIndependentCompletion(snapshot, event)
  ) {
    throw new Error("Task completion requires two matching passed reviews");
  }
  const completed = { ...snapshot };
  delete completed.attempt;
  return {
    ...completed,
    attention,
    baselineRecorded: false,
    before: null,
    planComplianceReview: null,
    session: null,
    standardsReview: null,
    status,
    task: null,
  };
}
