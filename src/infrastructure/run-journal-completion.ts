import { isDeepStrictEqual } from "node:util";

import type { RunJournalEvent, RunSnapshot } from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

function matchesCompletion(
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

export function completeTask(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): RunSnapshot {
  const status = transitionRun(snapshot.status, "complete_task");
  const standards = snapshot.standardsReview;
  const plan = snapshot.planComplianceReview;
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
    (!matchesCompletion(standards, event) || !matchesCompletion(plan, event))
  ) {
    throw new Error("Task completion requires two matching passed reviews");
  }
  const completed = { ...snapshot };
  delete completed.attempt;
  return {
    ...completed,
    attention: null,
    baselineRecorded: false,
    before: null,
    planComplianceReview: null,
    session: null,
    standardsReview: null,
    status,
    task: null,
  };
}
