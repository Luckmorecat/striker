import type {
  AgentSession,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function sameSession(
  left: AgentSession | null,
  right: AgentSession | null,
): boolean {
  return left?.id === right?.id && left?.resumeId === right?.resumeId;
}

function requireCurrentTask(snapshot: RunSnapshot, task: TaskIdentity): void {
  if (snapshot.task === null || !sameTask(snapshot.task.identity, task)) {
    throw new Error("Striker run event contradicts its snapshot task");
  }
}

export function replayEvent(
  snapshot: RunSnapshot,
  event: RunJournalEvent,
): RunSnapshot {
  switch (event.type) {
    case "run_started":
      throw new Error("Striker run snapshot missed a duplicate start event");
    case "run_source_changed":
      return replaySourceChange(snapshot);
    case "task_session_started":
      return replaySessionStart(snapshot, event);
    case "run_retried":
      return replayRetry(snapshot, event);
    case "task_completed":
      requireCurrentTask(snapshot, event.task);
      requireSnapshotSession(snapshot.session, event.session);
      return {
        ...replayCompletion(snapshot),
        status: transitionRun(snapshot.status, "complete_task"),
      };
    case "run_needs_attention":
      requireCurrentTask(snapshot, event.task);
      requireSnapshotSession(snapshot.session, event.session);
      return {
        ...snapshot,
        attention: event.attention,
        session: event.session,
        status: transitionRun(snapshot.status, "request_attention"),
      };
    case "run_failed":
      requireCurrentTask(snapshot, event.task);
      requireSnapshotSession(snapshot.session, event.session);
      return {
        ...snapshot,
        attention: null,
        session: event.session,
        status: transitionRun(snapshot.status, "fail"),
      };
    case "run_answered":
    case "run_resumed":
      requireCurrentTask(snapshot, event.task);
      requireSnapshotSession(snapshot.session, event.session);
      return {
        ...snapshot,
        attention: null,
        session: event.session,
        status: transitionRun(
          snapshot.status,
          event.type === "run_answered" ? "answer" : "resume",
        ),
      };
  }
}

function replaySourceChange(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    attention: null,
    session: null,
    status: transitionRun(snapshot.status, "request_attention"),
    task: null,
  };
}

function replaySessionStart(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "task_session_started" }>,
): RunSnapshot {
  requireCurrentTask(snapshot, event.task);
  const attempt = snapshot.attempt ?? 1;
  if (snapshot.status !== "running" || event.attempt !== attempt) {
    throw new Error("Striker session event contradicts its snapshot attempt");
  }
  if (snapshot.session !== null) {
    throw new Error("Striker session event contradicts its snapshot session");
  }
  return { ...snapshot, session: event.session };
}

function replayRetry(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "run_retried" }>,
): RunSnapshot {
  requireCurrentTask(snapshot, event.task);
  const attempt = snapshot.attempt ?? 1;
  if (event.attempt !== attempt) {
    throw new Error("Striker retry event contradicts its snapshot attempt");
  }
  return {
    ...snapshot,
    attempt: attempt + 1,
    attention: null,
    session: null,
    status: transitionRun(snapshot.status, "retry"),
  };
}

function requireSnapshotSession(
  current: AgentSession | null,
  event: AgentSession | null,
): void {
  if (current !== null && !sameSession(current, event)) {
    throw new Error("Striker run event changes the active session");
  }
}

function replayCompletion(snapshot: RunSnapshot): RunSnapshot {
  const completed = { ...snapshot };
  delete completed.attempt;
  return {
    ...completed,
    attention: null,
    session: null,
    status: "running",
    task: null,
  };
}
