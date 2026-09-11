import { isDeepStrictEqual } from "node:util";

import type {
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import { createLedgerState, transitionLedger } from "../core/ledger-state.js";
import { projectDiscoveryReviews } from "./discovery-review-history.js";
import { replayEvent } from "./run-journal-replay.js";
import { startSnapshot } from "./run-journal-start.js";
import {
  orderTaskOutcomes,
  projectTaskOutcome,
  type ProjectedTaskOutcome,
} from "./task-outcome-projection.js";

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

function replayJournalEvent(
  snapshot: RunSnapshot,
  event: Exclude<RunJournalEvent, { type: "run_started" }>,
  ledger: ReturnType<typeof createLedgerState>,
): { readonly ledger: typeof ledger; readonly snapshot: RunSnapshot } {
  if (event.type !== "ledger_transition_recorded") {
    return { ledger, snapshot: replayEvent(snapshot, event) };
  }
  const result = transitionLedger(ledger, event.transition);
  return {
    ledger: result.state,
    snapshot: replayEvent(snapshot, event, result.applied),
  };
}

export function replayPlanJournal(
  events: readonly RunJournalEvent[],
  planId: string,
  runId?: string,
): ReplayedPlanJournal {
  const runs = new Map<string, RunSnapshot>();
  let snapshot: RunSnapshot | undefined;
  const completed = new Map<string, TaskIdentity>();
  const ledgerTransitions: Extract<
    RunJournalEvent,
    { type: "ledger_transition_recorded" }
  >[] = [];
  const taskOutcomes: ProjectedTaskOutcome[] = [];
  let ledger = initialLedger(events);
  for (const event of events) {
    if (event.type === "run_started") {
      snapshot = replayStart(snapshot, event, planId, completed);
      rememberStart(runs, snapshot);
      continue;
    }
    if (snapshot === undefined) {
      throw new Error("Striker plan journal does not start with run_started");
    }
    const applied = historicalOperation(runs, event, snapshot);
    if (applied) {
      snapshot = applied;
      continue;
    }
    const outcome =
      event.type === "task_completed"
        ? projectTaskOutcome(snapshot, event, ledgerTransitions)
        : null;
    const replayed = replayJournalEvent(snapshot, event, ledger);
    snapshot = replayed.snapshot;
    runs.set(event.runId, snapshot);
    ledger = replayed.ledger;
    if (event.type === "ledger_transition_recorded") {
      ledgerTransitions.push(event);
    }
    if (event.type === "task_completed") {
      const key = taskKey(event.task);
      if (completed.has(key)) {
        throw new Error("Striker plan journal completes one task twice");
      }
      completed.set(key, event.task);
      if (outcome !== null) taskOutcomes.push(outcome);
    }
  }
  const lastEvent = events.at(-1);
  if (snapshot === undefined || lastEvent === undefined) {
    throw new Error("Striker plan journal is empty");
  }
  return {
    completedTasks: [...completed.values()],
    discoveryReviews: projectDiscoveryReviews(events),
    lastEvent: runLastEvent(events, selectedRun(runs, snapshot, runId)),
    ledgerTransitions,
    planId,
    snapshot: selectedRun(runs, snapshot, runId),
    taskOutcomes: orderTaskOutcomes(taskOutcomes),
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

function missingRun(): never {
  throw new Error("Run identity is missing from plan journal");
}

function initialLedger(events: readonly RunJournalEvent[]) {
  const allTransitions = events.filter(
    (
      event,
    ): event is Extract<
      RunJournalEvent,
      { type: "ledger_transition_recorded" }
    > => event.type === "ledger_transition_recorded",
  );
  return createLedgerState({
    assumptions: allTransitions
      .filter((event) => event.transition.kind === "assumption")
      .map((event) => event.transition.id),
    defaults: allTransitions
      .filter((event) => event.transition.kind === "default")
      .map((event) => event.transition.id),
  });
}

function historicalOperation(
  runs: Map<string, RunSnapshot>,
  event: Exclude<RunJournalEvent, { type: "run_started" }>,
  snapshot: RunSnapshot,
): RunSnapshot | null {
  if (
    event.type !== "cleanup_started" &&
    event.type !== "cleanup_completed" &&
    event.type !== "application_started" &&
    event.type !== "application_completed"
  )
    return null;
  const original = runs.get(event.runId);
  if (!original) throw new Error("Application run is missing from the journal");
  const applied = replayEvent(original, event);
  runs.set(event.runId, applied);
  return snapshot.runId === event.runId ? applied : snapshot;
}

function rememberStart(runs: Map<string, RunSnapshot>, snapshot: RunSnapshot) {
  if (runs.has(snapshot.runId))
    throw new Error("Duplicate run identity in plan journal");
  runs.set(snapshot.runId, snapshot);
}
function selectedRun(
  runs: Map<string, RunSnapshot>,
  snapshot: RunSnapshot,
  runId?: string,
) {
  return runId === undefined ? snapshot : (runs.get(runId) ?? missingRun());
}

function runLastEvent(
  events: readonly RunJournalEvent[],
  snapshot: RunSnapshot,
): RunJournalEvent {
  return (
    events.findLast((event) => event.runId === snapshot.runId) ?? missingRun()
  );
}
