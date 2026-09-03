import type {
  AgentSession,
  GitState,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";
import { completeTask } from "./run-journal-completion.js";
import {
  isLedgerEvent,
  replayLedgerEvent,
  type LedgerEvent,
} from "./run-journal-ledger-replay.js";
import {
  isPlanReviewEvent,
  planReviewAfterAttention,
  planReviewAfterRetry,
  replayPlanReviewEvent,
  type PlanReviewEvent,
} from "./run-journal-plan-review-replay.js";
import {
  isReviewEvent,
  replayReviewEvent,
  type ReviewEvent,
} from "./run-journal-review-replay.js";

type ReplayEvent = Exclude<RunJournalEvent, { type: "run_started" }>;
type ProgressEvent = Extract<
  ReplayEvent,
  {
    type:
      | "task_selected"
      | "task_baseline_recorded"
      | "task_attempt_started"
      | "task_session_started"
      | "run_retried";
  }
>;
type ResultEvent = Extract<
  ReplayEvent,
  {
    type:
      | "task_completed"
      | "run_needs_attention"
      | "run_failed"
      | "run_answered"
      | "run_resumed";
  }
>;

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function sameSession(
  left: AgentSession | null,
  right: AgentSession | null,
): boolean {
  return left?.id === right?.id && left?.resumeId === right?.resumeId;
}

function requireTask(snapshot: RunSnapshot, task: TaskIdentity): void {
  if (snapshot.task === null || !sameTask(snapshot.task.identity, task)) {
    throw new Error("Striker run event contradicts its selected task");
  }
}

function requireSession(
  current: AgentSession | null,
  event: AgentSession | null,
): void {
  if (current === null || !sameSession(current, event)) {
    throw new Error("Striker run event changes the active session");
  }
}

export function startSnapshot(
  event: Extract<RunJournalEvent, { type: "run_started" }>,
): RunSnapshot {
  const { planId, request } = event;
  if (request.runId !== event.runId) {
    throw new Error("Striker run start contains a mismatched request");
  }
  if (request.planId !== planId) {
    throw new Error("Striker run start contains a mismatched plan identity");
  }
  return {
    attention: null,
    baselineRecorded: false,
    before: null,
    planId,
    preparedRequest: null,
    request,
    runId: event.runId,
    session: null,
    status: "running",
    task: null,
  };
}

export function replayEvent(
  snapshot: RunSnapshot,
  event: ReplayEvent,
  ledgerTransitionApplied = true,
): RunSnapshot {
  if (event.runId !== snapshot.runId) {
    throw new Error("Striker plan journal contains a mismatched run id");
  }
  if (isLedgerEvent(event)) {
    return replayLedgerEvent(snapshot, event, ledgerTransitionApplied);
  }
  if (isPlanReviewEvent(event)) return replayPlanReviewEvent(snapshot, event);
  if (isReviewEvent(event)) return replayReviewEvent(snapshot, event);
  if (isProgressEvent(event)) return replayProgress(snapshot, event);
  if (isResultEvent(event)) return replayResult(snapshot, event);
  return replayTerminal(snapshot, event);
}

function isProgressEvent(event: ReplayEvent): event is ProgressEvent {
  return [
    "task_selected",
    "task_baseline_recorded",
    "task_attempt_started",
    "task_session_started",
    "run_retried",
  ].includes(event.type);
}

function isResultEvent(event: ReplayEvent): event is ResultEvent {
  return [
    "task_completed",
    "run_needs_attention",
    "run_failed",
    "run_answered",
    "run_resumed",
  ].includes(event.type);
}

function replayProgress(
  snapshot: RunSnapshot,
  event: ProgressEvent,
): RunSnapshot {
  switch (event.type) {
    case "task_selected":
      return selectTask(snapshot, event.task);
    case "task_baseline_recorded":
      return recordBaseline(snapshot, event.task, event.before);
    case "task_attempt_started":
      return startAttempt(snapshot, event.task, event.attempt);
    case "task_session_started":
      return startSession(
        snapshot,
        event.task,
        event.attempt,
        event.session,
        event.request,
      );
    case "run_retried":
      requireTask(snapshot, event.task);
      if ((snapshot.attempt ?? 0) !== event.attempt) {
        throw new Error("Striker retry event has an invalid attempt");
      }
      return {
        ...snapshot,
        attention: null,
        planComplianceReview: planReviewAfterRetry(snapshot),
        preparedRequest: null,
        session: null,
        standardsReview: reviewAfterRetry(snapshot),
        status: transitionRun(snapshot.status, "retry"),
      };
  }
}

function replayResult(snapshot: RunSnapshot, event: ResultEvent): RunSnapshot {
  requireTask(snapshot, event.task);
  switch (event.type) {
    case "task_completed":
      requireSession(snapshot.session, event.session);
      return completeTask(snapshot, event);
    case "run_needs_attention":
      if (snapshot.session !== null || event.session !== null) {
        requireSession(snapshot.session, event.session);
      }
      return {
        ...snapshot,
        attention: event.attention,
        planComplianceReview: planReviewAfterAttention(snapshot),
        session: event.session,
        standardsReview: reviewAfterAttention(snapshot),
        status: transitionRun(snapshot.status, "request_attention"),
      };
    case "run_failed":
      requireSession(snapshot.session, event.session);
      return {
        ...snapshot,
        attention: null,
        status: transitionRun(snapshot.status, "fail"),
      };
    case "run_answered":
    case "run_resumed":
      requireSession(snapshot.session, event.session);
      return {
        ...snapshot,
        attention: null,
        status: transitionRun(
          snapshot.status,
          event.type === "run_answered" ? "answer" : "resume",
        ),
      };
  }
}

function reviewAfterAttention(
  snapshot: RunSnapshot,
): Exclude<RunSnapshot["standardsReview"], undefined> {
  const review = snapshot.standardsReview;
  return review?.stage === "repaired" || review?.stage === "repair_attention"
    ? { ...review, stage: "repair_attention" }
    : null;
}

function reviewAfterRetry(
  snapshot: RunSnapshot,
): Exclude<RunSnapshot["standardsReview"], undefined> {
  const review = snapshot.standardsReview;
  return review?.result?.verdict === "changes_required"
    ? { ...review, repairOutput: null, stage: "repair_attention" }
    : null;
}

function replayTerminal(
  snapshot: RunSnapshot,
  event: Exclude<
    ReplayEvent,
    LedgerEvent | PlanReviewEvent | ProgressEvent | ResultEvent | ReviewEvent
  >,
): RunSnapshot {
  switch (event.type) {
    case "run_source_changed":
      if (snapshot.task !== null) {
        throw new Error("Source conflict occurred during an active task");
      }
      return {
        ...snapshot,
        status: transitionRun(snapshot.status, "request_attention"),
      };
    case "run_completed":
      if (snapshot.task !== null) {
        throw new Error("Striker run completed with an active task");
      }
      return {
        ...snapshot,
        status: transitionRun(snapshot.status, "complete"),
      };
    case "run_discarded":
      return {
        ...snapshot,
        status: transitionRun(snapshot.status, "discard"),
      };
  }
}

function selectTask(
  snapshot: RunSnapshot,
  task: RunSnapshot["task"],
): RunSnapshot {
  if (
    snapshot.status !== "running" ||
    snapshot.task !== null ||
    task === null
  ) {
    throw new Error("Striker task selection has an invalid run state");
  }
  return {
    ...snapshot,
    baselineRecorded: false,
    before: null,
    planComplianceReview: null,
    preparedRequest: null,
    standardsReview: null,
    task,
  };
}

function startAttempt(
  snapshot: RunSnapshot,
  task: TaskIdentity,
  attempt: number,
): RunSnapshot {
  requireTask(snapshot, task);
  const expected = snapshot.attempt === undefined ? 1 : snapshot.attempt + 1;
  if (
    snapshot.status !== "running" ||
    snapshot.baselineRecorded !== true ||
    attempt !== expected
  ) {
    if (snapshot.baselineRecorded !== true) {
      throw new Error("Striker attempt event is missing its baseline");
    }
    throw new Error("Striker attempt event has an invalid attempt");
  }
  return {
    ...snapshot,
    attempt,
    attention: null,
    preparedRequest: null,
    session: null,
  };
}

function recordBaseline(
  snapshot: RunSnapshot,
  task: TaskIdentity,
  before: GitState | null,
): RunSnapshot {
  requireTask(snapshot, task);
  if (
    snapshot.status !== "running" ||
    snapshot.baselineRecorded === true ||
    snapshot.attempt !== undefined
  ) {
    throw new Error("Striker baseline event has an invalid run state");
  }
  return { ...snapshot, baselineRecorded: true, before };
}

function startSession(
  snapshot: RunSnapshot,
  task: TaskIdentity,
  attempt: number,
  session: AgentSession,
  preparedRequest: NonNullable<RunSnapshot["preparedRequest"]>,
): RunSnapshot {
  requireTask(snapshot, task);
  if (
    snapshot.status !== "running" ||
    snapshot.attempt !== attempt ||
    snapshot.session !== null
  ) {
    throw new Error("Striker session event has an invalid attempt");
  }
  return { ...snapshot, preparedRequest, session };
}
