import { isDeepStrictEqual } from "node:util";

import type {
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { replayEvent, startSnapshot } from "./run-journal-replay.js";

export interface ReplayedPlanJournal extends RunRecoveryState {
  readonly planId: string;
  readonly snapshot: RunSnapshot;
}

function taskKey(task: TaskIdentity): string {
  return `${task.id}\u0000${task.revision}`;
}

function replayStart(
  snapshot: RunSnapshot | undefined,
  event: Extract<RunJournalEvent, { type: "run_started" }>,
  planId: string,
  completed: Map<string, TaskIdentity>,
): RunSnapshot {
  if (
    snapshot !== undefined &&
    snapshot.status !== "completed" &&
    snapshot.status !== "discarded"
  ) {
    throw new Error("Striker plan journal starts a second active run");
  }
  if (event.planId !== planId) {
    throw new Error("Striker plan journal contains a mismatched plan id");
  }
  for (const identity of event.request.completedTasks) {
    completed.set(taskKey(identity), identity);
  }
  return startSnapshot(event);
}

export function replayPlanJournal(
  events: readonly RunJournalEvent[],
  planId: string,
): ReplayedPlanJournal {
  let snapshot: RunSnapshot | undefined;
  const completed = new Map<string, TaskIdentity>();
  for (const event of events) {
    if (event.type === "run_started") {
      snapshot = replayStart(snapshot, event, planId, completed);
      continue;
    }
    if (snapshot === undefined) {
      throw new Error("Striker plan journal does not start with run_started");
    }
    snapshot = replayEvent(snapshot, event);
    if (event.type === "task_completed") {
      const key = taskKey(event.task);
      if (completed.has(key)) {
        throw new Error("Striker plan journal completes one task twice");
      }
      completed.set(key, event.task);
    }
  }
  const lastEvent = events.at(-1);
  if (snapshot === undefined || lastEvent === undefined) {
    throw new Error("Striker plan journal is empty");
  }
  return {
    completedTasks: [...completed.values()],
    lastEvent,
    planId,
    snapshot,
  };
}

export function assertEventSequence(
  events: readonly RunJournalEvent[],
  planId: string,
): void {
  replayPlanJournal(events, planId);
}

export function assertSnapshotPrefix(
  snapshot: RunSnapshot,
  events: readonly RunJournalEvent[],
  planId = snapshot.planId,
): void {
  const expected = replayPlanJournal(events, planId).snapshot;
  if (!isDeepStrictEqual(snapshot, expected)) {
    throw new Error("Striker run snapshot contradicts its event prefix");
  }
}
