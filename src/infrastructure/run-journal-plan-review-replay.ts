import { isDeepStrictEqual } from "node:util";

import type {
  AgentSession,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

export type PlanReviewEvent = Extract<
  RunJournalEvent,
  {
    type:
      | "plan_compliance_repair_completed"
      | "plan_compliance_repair_interrupted"
      | "plan_compliance_repair_started"
      | "plan_compliance_review_completed"
      | "plan_compliance_review_interrupted"
      | "plan_compliance_review_started";
  }
>;

const eventTypes: readonly PlanReviewEvent["type"][] = [
  "plan_compliance_repair_completed",
  "plan_compliance_repair_interrupted",
  "plan_compliance_repair_started",
  "plan_compliance_review_completed",
  "plan_compliance_review_interrupted",
  "plan_compliance_review_started",
];

export function isPlanReviewEvent(
  event: RunJournalEvent,
): event is PlanReviewEvent {
  return eventTypes.includes(event.type as PlanReviewEvent["type"]);
}

export function planReviewAfterAttention(
  snapshot: RunSnapshot,
): Exclude<RunSnapshot["planComplianceReview"], undefined> {
  const review = snapshot.planComplianceReview;
  return review?.stage === "repaired" || review?.stage === "repair_attention"
    ? { ...review, stage: "repair_attention" }
    : (review ?? null);
}

export function planReviewAfterRetry(
  snapshot: RunSnapshot,
): Exclude<RunSnapshot["planComplianceReview"], undefined> {
  const review = snapshot.planComplianceReview;
  return review?.result?.verdict === "changes_required"
    ? { ...review, repairOutput: null, stage: "repair_attention" }
    : null;
}

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function sameSession(left: AgentSession, right: AgentSession): boolean {
  return left.id === right.id && left.resumeId === right.resumeId;
}

function requireTask(snapshot: RunSnapshot, task: TaskIdentity): void {
  if (snapshot.task === null || !sameTask(snapshot.task.identity, task)) {
    throw new Error("Striker plan review contradicts its selected task");
  }
}

function startReview(
  snapshot: RunSnapshot,
  event: Extract<PlanReviewEvent, { type: "plan_compliance_review_started" }>,
): RunSnapshot {
  const standards = snapshot.standardsReview;
  if (
    snapshot.session === null ||
    snapshot.attempt !== event.attempt ||
    snapshot.before?.head !== event.startCommit ||
    standards?.stage !== "passed" ||
    !isDeepStrictEqual(standards.result, event.standards) ||
    !["running", "needs_attention"].includes(snapshot.status)
  ) {
    throw new Error("Plan-compliance review has invalid candidate evidence");
  }
  return {
    ...snapshot,
    attention: null,
    planComplianceReview: {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      completion: event.completion,
      result: null,
      resultCommit: event.resultCommit,
      repairOutput: null,
      reviewSession: event.session,
      stage: "reviewing",
      standards: event.standards,
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
  event: Extract<PlanReviewEvent, { type: "plan_compliance_review_completed" }>,
): RunSnapshot {
  const review = snapshot.planComplianceReview;
  if (
    review?.stage !== "reviewing" ||
    review.reviewSession === null ||
    !sameSession(review.reviewSession, event.session) ||
    review.startCommit !== event.result.startCommit ||
    review.resultCommit !== event.result.resultCommit
  ) {
    throw new Error("Plan-compliance result contradicts its candidate");
  }
  return {
    ...snapshot,
    planComplianceReview: {
      ...review,
      result: event.result,
      stage: event.result.verdict === "passed" ? "passed" : "changes_required",
    },
  };
}

function interruptReview(
  snapshot: RunSnapshot,
  event: Extract<
    PlanReviewEvent,
    { type: "plan_compliance_review_interrupted" }
  >,
): RunSnapshot {
  const standards = snapshot.standardsReview;
  const review = snapshot.planComplianceReview;
  if (
    snapshot.status !== "running" ||
    standards?.stage !== "passed" ||
    !isDeepStrictEqual(standards.result, event.standards) ||
    (review?.stage === "reviewing" &&
      (event.session === null ||
        review.reviewSession === null ||
        !sameSession(review.reviewSession, event.session)))
  ) {
    throw new Error("Plan-compliance interruption has invalid state");
  }
  return {
    ...snapshot,
    attention: event.attention,
    planComplianceReview: {
      attempt: event.attempt,
      changedPaths: event.changedPaths,
      completion: event.completion,
      result: null,
      resultCommit: event.resultCommit,
      repairOutput: null,
      reviewSession: event.session,
      stage: "interrupted",
      standards: event.standards,
      startCommit: event.startCommit,
      verification: event.verification,
    },
    status: transitionRun(snapshot.status, "request_attention"),
  };
}

function startRepair(
  snapshot: RunSnapshot,
  event: Extract<PlanReviewEvent, { type: "plan_compliance_repair_started" }>,
): RunSnapshot {
  const review = snapshot.planComplianceReview;
  if (
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    review == null ||
    !["changes_required", "repair_interrupted"].includes(review.stage) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Plan-compliance repair has invalid review evidence");
  }
  return {
    ...snapshot,
    attention: null,
    planComplianceReview: { ...review, repairOutput: null, stage: "repairing" },
    status:
      snapshot.status === "needs_attention"
        ? transitionRun(snapshot.status, "resume")
        : snapshot.status,
  };
}

function completeRepair(
  snapshot: RunSnapshot,
  event: Extract<PlanReviewEvent, { type: "plan_compliance_repair_completed" }>,
): RunSnapshot {
  const review = snapshot.planComplianceReview;
  if (
    snapshot.status !== "running" ||
    review?.stage !== "repairing" ||
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Plan-compliance repair result has invalid state");
  }
  return {
    ...snapshot,
    planComplianceReview: {
      ...review,
      repairOutput: event.output,
      stage: "repaired",
    },
  };
}

function interruptRepair(
  snapshot: RunSnapshot,
  event: Extract<
    PlanReviewEvent,
    { type: "plan_compliance_repair_interrupted" }
  >,
): RunSnapshot {
  const review = snapshot.planComplianceReview;
  if (
    snapshot.status !== "running" ||
    review?.stage !== "repairing" ||
    snapshot.session === null ||
    !sameSession(snapshot.session, event.session) ||
    !isDeepStrictEqual(review.result, event.result)
  ) {
    throw new Error("Plan-compliance repair interruption has invalid state");
  }
  return {
    ...snapshot,
    attention: event.attention,
    planComplianceReview: { ...review, stage: "repair_interrupted" },
    status: transitionRun(snapshot.status, "request_attention"),
  };
}

export function replayPlanReviewEvent(
  snapshot: RunSnapshot,
  event: PlanReviewEvent,
): RunSnapshot {
  requireTask(snapshot, event.task);
  switch (event.type) {
    case "plan_compliance_review_started":
      return startReview(snapshot, event);
    case "plan_compliance_review_completed":
      return completeReview(snapshot, event);
    case "plan_compliance_review_interrupted":
      return interruptReview(snapshot, event);
    case "plan_compliance_repair_started":
      return startRepair(snapshot, event);
    case "plan_compliance_repair_completed":
      return completeRepair(snapshot, event);
    case "plan_compliance_repair_interrupted":
      return interruptRepair(snapshot, event);
  }
}
