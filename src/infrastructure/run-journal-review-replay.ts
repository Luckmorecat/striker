import { isDeepStrictEqual } from "node:util";

import type {
  AgentSession,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

export type ReviewEvent = Extract<
  RunJournalEvent,
  {
    type:
      | "standards_repair_interrupted"
      | "standards_repair_completed"
      | "standards_repair_started"
      | "standards_review_completed"
      | "standards_review_interrupted"
      | "standards_review_started";
  }
>;

const eventTypes: readonly ReviewEvent["type"][] = [
  "standards_repair_interrupted",
  "standards_repair_completed",
  "standards_repair_started",
  "standards_review_completed",
  "standards_review_interrupted",
  "standards_review_started",
];

export function isReviewEvent(event: RunJournalEvent): event is ReviewEvent {
  return eventTypes.includes(event.type as ReviewEvent["type"]);
}

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function sameSession(left: AgentSession, right: AgentSession): boolean {
  return left.id === right.id && left.resumeId === right.resumeId;
}

function requireTask(snapshot: RunSnapshot, task: TaskIdentity): void {
  if (snapshot.task === null || !sameTask(snapshot.task.identity, task)) {
    throw new Error("Striker review event contradicts its selected task");
  }
}

function startReview(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_review_started" }>,
): RunSnapshot {
  if (
    snapshot.session === null ||
    snapshot.attempt !== event.attempt ||
    snapshot.before?.head !== event.startCommit ||
    !["running", "needs_attention"].includes(snapshot.status)
  ) {
    throw new Error("Standards review has invalid candidate evidence");
  }
  return {
    ...snapshot,
    attention: null,
    standardsReview: {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      completion: event.completion,
      result: null,
      resultCommit: event.resultCommit,
      repairOutput: null,
      reviewSession: event.session,
      stage: "reviewing",
      startCommit: event.startCommit,
      verification: event.verification,
    },
    status:
      snapshot.status === "needs_attention"
        ? transitionRun(snapshot.status, "resume")
        : snapshot.status,
  };
}

function completeReview(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_review_completed" }>,
): RunSnapshot {
  const review = snapshot.standardsReview;
  if (
    review?.stage !== "reviewing" ||
    review.reviewSession === null ||
    !sameSession(review.reviewSession, event.session) ||
    review.startCommit !== event.result.startCommit ||
    review.resultCommit !== event.result.resultCommit
  ) {
    throw new Error("Standards review result contradicts its candidate");
  }
  return {
    ...snapshot,
    standardsReview: {
      ...review,
      result: event.result,
      stage: event.result.verdict === "passed" ? "passed" : "changes_required",
    },
  };
}

function interruptReview(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_review_interrupted" }>,
): RunSnapshot {
  const review = snapshot.standardsReview;
  if (
    snapshot.status !== "running" ||
    (review?.stage === "reviewing" &&
      (event.session === null ||
        review.reviewSession === null ||
        !sameSession(review.reviewSession, event.session)))
  ) {
    throw new Error("Standards review interruption has invalid state");
  }
  return {
    ...snapshot,
    attention: event.attention,
    standardsReview: {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      completion: event.completion,
      result: null,
      resultCommit: event.resultCommit,
      repairOutput: null,
      reviewSession: event.session,
      stage: "interrupted",
      startCommit: event.startCommit,
      verification: event.verification,
    },
    status: transitionRun(snapshot.status, "request_attention"),
  };
}

function startRepair(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_repair_started" }>,
): RunSnapshot {
  const review = snapshot.standardsReview;
  if (
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    review === null ||
    review === undefined ||
    !["changes_required", "repair_interrupted"].includes(review.stage) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Standards repair has invalid review evidence");
  }
  return {
    ...snapshot,
    attention: null,
    standardsReview: { ...review, repairOutput: null, stage: "repairing" },
    status:
      snapshot.status === "needs_attention"
        ? transitionRun(snapshot.status, "resume")
        : snapshot.status,
  };
}

function completeRepair(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_repair_completed" }>,
): RunSnapshot {
  const review = snapshot.standardsReview;
  if (
    snapshot.status !== "running" ||
    review?.stage !== "repairing" ||
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Standards repair result has invalid state");
  }
  return {
    ...snapshot,
    standardsReview: {
      ...review,
      repairOutput: event.output,
      stage: "repaired",
    },
  };
}

function interruptRepair(
  snapshot: RunSnapshot,
  event: Extract<ReviewEvent, { type: "standards_repair_interrupted" }>,
): RunSnapshot {
  const review = snapshot.standardsReview;
  if (
    snapshot.status !== "running" ||
    review?.stage !== "repairing" ||
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Standards repair interruption has invalid state");
  }
  return {
    ...snapshot,
    attention: event.attention,
    standardsReview: { ...review, stage: "repair_interrupted" },
    status: transitionRun(snapshot.status, "request_attention"),
  };
}

export function replayReviewEvent(
  snapshot: RunSnapshot,
  event: ReviewEvent,
): RunSnapshot {
  requireTask(snapshot, event.task);
  switch (event.type) {
    case "standards_review_started":
      return startReview(snapshot, event);
    case "standards_review_completed":
      return completeReview(snapshot, event);
    case "standards_review_interrupted":
      return interruptReview(snapshot, event);
    case "standards_repair_started":
      return startRepair(snapshot, event);
    case "standards_repair_interrupted":
      return interruptRepair(snapshot, event);
    case "standards_repair_completed":
      return completeRepair(snapshot, event);
  }
}
