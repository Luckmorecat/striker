import type { RunRecoveryState } from "./contracts.js";
import { isCompletedDiscoveryPause } from "./discovery-reconciliation.js";
import {
  completedTaskRequest,
  recoverableRun,
  reviewOwnsRecovery,
} from "./recovery-context.js";

export type RecoveryAction = "answer" | "resume" | "retry";

/** Null means available; a string explains why the operation is unavailable. */
export function recoveryBlocker(
  recovery: RunRecoveryState,
  action: RecoveryAction,
): string | null {
  try {
    validateRecovery(recovery, action);
    return null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

export function validateRecovery(
  recovery: RunRecoveryState,
  action: RecoveryAction,
): void {
  if (exportResume(recovery, action)) return;
  if (action === "answer") {
    validateAnswer(recovery);
    return;
  }
  if (action === "retry") {
    validateRetry(recovery);
    return;
  }
  if (isCompletedDiscoveryPause(recovery.snapshot)) {
    throw new Error("Discovery attention requires a developer answer");
  }
  if (
    completedTaskRequest(recovery) !== null ||
    reviewOwnsRecovery(recovery.snapshot)
  )
    return;
  recoverableRun(recovery, ["needs_attention", "running"]);
}

function validateAnswer(recovery: RunRecoveryState): void {
  if (reviewOwnsRecovery(recovery.snapshot)) {
    throw new Error(
      "Standards review recovery does not accept developer answers",
    );
  }
  if (isCompletedDiscoveryPause(recovery.snapshot)) return;
  const run = recoverableRun(recovery, ["needs_attention"]);
  if (run.session === null)
    throw new Error("Paused Striker run has no session to answer");
}

function validateRetry(recovery: RunRecoveryState): void {
  const run = recoverableRun(recovery, ["failed", "needs_attention"]);
  if (
    recovery.completedTasks.some(
      (identity) =>
        identity.id === run.task.identity.id &&
        identity.revision === run.task.identity.revision,
    )
  ) {
    throw new Error("Cannot retry a completed Striker task");
  }
}

/** Inspection omits accepted operations that cannot advance the current pause. */
export function continuationBlocker(
  recovery: RunRecoveryState,
  action: RecoveryAction,
): string | null {
  const blocker = recoveryBlocker(recovery, action);
  if (blocker !== null) return blocker;
  const snapshot = recovery.snapshot;
  if (exportResume(recovery, action)) return null;
  if (
    action !== "answer" &&
    snapshot?.attention?.reason === "task_outcome_limit_exceeded"
  )
    return "Outcome delivery exceeds the limit; revise the plan routes or fact relevance and start a new run";
  if (
    action === "resume" &&
    snapshot?.status === "needs_attention" &&
    snapshot.session === null &&
    !reviewOwnsRecovery(snapshot)
  )
    return "Paused Striker run has no session to resume; retry a fresh attempt";
  return null;
}

function exportResume(
  recovery: RunRecoveryState,
  action: RecoveryAction,
): boolean {
  return (
    action === "resume" && recovery.snapshot?.resultExport?.pending != null
  );
}
