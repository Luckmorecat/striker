import type {
  AgentSession,
  AttentionReason,
  RunJournalEvent,
  RunSnapshot,
  RunStatus,
  TaskIdentity,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";

interface JournalState {
  readonly attempt: number;
  readonly attention: AttentionReason | null;
  readonly session: AgentSession | null;
  readonly status: RunStatus;
  readonly task: TaskIdentity | null;
}

const initialState: JournalState = {
  attempt: 0,
  attention: null,
  session: null,
  status: "running",
  task: null,
};

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function sameSession(
  left: AgentSession | null,
  right: AgentSession | null,
): boolean {
  return left?.id === right?.id && left?.resumeId === right?.resumeId;
}

export function assertEventSequence(
  events: readonly RunJournalEvent[],
  runId: string,
): void {
  if (events[0]?.type !== "run_started") {
    throw new Error("Striker run journal does not start with run_started");
  }
  const completed = new Set<string>();
  events.forEach((event, index) => {
    if (event.runId !== runId) {
      throw new Error("Striker run journal contains a mismatched run id");
    }
    if (index > 0 && event.type === "run_started") {
      throw new Error("Striker run journal contains duplicate run_started");
    }
    if (event.type === "task_completed") {
      const key = `${event.task.id}\u0000${event.task.revision}`;
      if (completed.has(key)) {
        throw new Error("Striker run journal completes one task twice");
      }
      completed.add(key);
    }
  });
  events.slice(1).reduce(reduceJournalEvent, initialState);
}

function adoptTask(state: JournalState, task: TaskIdentity): JournalState {
  if (state.task === null) {
    return { ...state, attempt: state.attempt || 1, task };
  }
  if (!sameTask(state.task, task)) {
    throw new Error("Striker run event changes the active task");
  }
  return state;
}

function reduceJournalEvent(
  current: JournalState,
  event: RunJournalEvent,
): JournalState {
  if (event.type === "run_started") {
    throw new Error("Striker run journal contains duplicate run_started");
  }
  if (event.type === "run_source_changed") {
    if (current.task !== null) {
      throw new Error("Source conflict occurred during an active task");
    }
    return {
      ...current,
      status: transitionRun(current.status, "request_attention"),
    };
  }
  const state = adoptTask(current, event.task);
  switch (event.type) {
    case "task_session_started":
      return reduceSessionStart(state, event);
    case "run_retried":
      return reduceRetry(state, event);
    case "task_completed":
      requireStateSession(state, event.session);
      return {
        ...state,
        attempt: 0,
        attention: null,
        session: null,
        status: transitionRun(state.status, "complete_task"),
        task: null,
      };
    case "run_needs_attention":
      requireStateSession(state, event.session);
      return {
        ...state,
        attention: event.attention.reason,
        session: event.session,
        status: transitionRun(state.status, "request_attention"),
      };
    case "run_failed":
      requireStateSession(state, event.session);
      return {
        ...state,
        attention: null,
        session: event.session,
        status: transitionRun(state.status, "fail"),
      };
    case "run_answered":
      requireStateSession(state, event.session);
      return {
        ...state,
        attention: null,
        session: event.session,
        status: transitionRun(state.status, "answer"),
      };
    case "run_resumed":
      requireStateSession(state, event.session);
      return {
        ...state,
        attention: null,
        session: event.session,
        status: transitionRun(state.status, "resume"),
      };
  }
}

function reduceSessionStart(
  state: JournalState,
  event: Extract<RunJournalEvent, { type: "task_session_started" }>,
): JournalState {
  if (state.status !== "running" || event.attempt !== state.attempt) {
    throw new Error("Striker session event has an invalid attempt");
  }
  if (state.session !== null) {
    throw new Error("Striker task starts more than one session per attempt");
  }
  return { ...state, session: event.session };
}

function requireStateSession(
  state: JournalState,
  session: AgentSession | null,
): void {
  if (state.session !== null && !sameSession(state.session, session)) {
    throw new Error("Striker run event changes the active session");
  }
}

function reduceRetry(
  state: JournalState,
  event: Extract<RunJournalEvent, { type: "run_retried" }>,
): JournalState {
  if (event.attempt !== state.attempt) {
    throw new Error("Striker retry event has an invalid attempt");
  }
  return {
    ...state,
    attempt: state.attempt + 1,
    attention: null,
    session: null,
    status: transitionRun(state.status, "retry"),
  };
}

export function assertSnapshotPrefix(
  snapshot: RunSnapshot,
  events: readonly RunJournalEvent[],
): void {
  const state = events.slice(1).reduce(reduceJournalEvent, initialState);
  if (snapshot.status !== state.status) {
    throw new Error("Striker run snapshot contradicts its event status");
  }
  assertCompletedSnapshot(snapshot, events.at(-1));
  assertSnapshotTask(snapshot, state);
  if (state.task !== null && (snapshot.attempt ?? 1) !== state.attempt) {
    throw new Error("Striker run snapshot contradicts its event attempt");
  }
  if (state.task !== null && !sameSession(snapshot.session, state.session)) {
    throw new Error("Striker run snapshot contradicts its event session");
  }
  if ((snapshot.attention?.reason ?? null) !== state.attention) {
    throw new Error("Striker run snapshot contradicts its attention event");
  }
}

function assertCompletedSnapshot(
  snapshot: RunSnapshot,
  lastEvent: RunJournalEvent | undefined,
): void {
  if (lastEvent?.type !== "task_completed") return;
  if (
    snapshot.task !== null ||
    snapshot.session !== null ||
    snapshot.attempt !== undefined
  ) {
    throw new Error("Striker run snapshot retains a completed task");
  }
}

function assertSnapshotTask(snapshot: RunSnapshot, state: JournalState): void {
  if (
    state.task !== null &&
    (snapshot.task === null || !sameTask(snapshot.task.identity, state.task))
  ) {
    throw new Error("Striker run snapshot contradicts its event task");
  }
  if (
    state.status !== "running" &&
    state.task === null &&
    snapshot.task !== null
  ) {
    throw new Error("Striker run snapshot has a task after a terminal event");
  }
}

export function inferSnapshotEventCount(
  snapshot: RunSnapshot,
  events: readonly RunJournalEvent[],
): number {
  for (let count = events.length; count >= 1; count -= 1) {
    try {
      assertSnapshotPrefix(snapshot, events.slice(0, count));
      return count;
    } catch {
      continue;
    }
  }
  throw new Error("Striker run snapshot matches no durable event prefix");
}
