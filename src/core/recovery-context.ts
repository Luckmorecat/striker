import type {
  AgentSession,
  DispatchResult,
  DispatchRequest,
  GitState,
  ImplementationTask,
  RunAttention,
  RunRecoveryState,
  RunJournal,
  RunSnapshot,
  RunStatus,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

export interface RecoverableRun {
  readonly attempt: number;
  readonly attention: RunAttention | null;
  readonly baselineRecorded: boolean;
  readonly before: GitState | undefined;
  readonly planComplianceReview: RunSnapshot["planComplianceReview"];
  readonly request: DispatchRequest;
  readonly session: RunSnapshot["session"];
  readonly standardsReview: RunSnapshot["standardsReview"];
  readonly status: "failed" | "needs_attention" | "running";
  readonly task: ImplementationTask;
}

export function completedTaskRequest(
  recovery: RunRecoveryState,
): DispatchRequest | null {
  const snapshot = recovery.snapshot;
  const canContinue =
    recovery.lastEvent.type === "task_completed" ||
    (snapshot?.status === "running" && snapshot.task === null);
  if (!canContinue) return null;
  if (snapshot === null) {
    throw new Error("Completed Striker task is missing its run request");
  }
  return snapshot.request;
}

export function appendRunContinuation(
  journal: RunJournal,
  paused: RecoverableRun & { readonly session: AgentSession },
  answer?: string,
): Promise<void> {
  if (answer === undefined) {
    return journal.append({
      ...(paused.attention === null ? {} : { attention: paused.attention }),
      runId: paused.request.runId,
      session: paused.session,
      task: paused.task.identity,
      type: "run_resumed",
    });
  }
  return journal.append({
    answer,
    runId: paused.request.runId,
    session: paused.session,
    task: paused.task.identity,
    type: "run_answered",
  });
}

export function pausedSessionlessRun(
  run: RecoverableRun,
): DispatchResult | null {
  if (run.session !== null || run.status !== "needs_attention") return null;
  if (run.attention === null) {
    throw new Error("Paused Striker run is missing attention evidence");
  }
  return {
    reason: run.attention.reason,
    runId: run.request.runId,
    session: null,
    status: "needs_attention",
    task: run.task,
  };
}

export async function pauseResumeFailure(
  journal: RunJournal,
  paused: RecoverableRun,
  error: unknown,
): Promise<DispatchResult> {
  const message = error instanceof Error ? error.message : String(error);
  const failure = `Could not resume the preserved session: ${message}`.slice(
    0,
    1_800,
  );
  const attention: RunAttention = {
    detail: `${failure}. Run \`striker retry\` to start a fresh attempt.`,
    reason: "session_resume_failed",
  };
  transitionRun(paused.status, "request_attention");
  await journal.append({
    attention,
    runId: paused.request.runId,
    session: paused.session,
    task: paused.task.identity,
    type: "run_needs_attention",
  });
  return {
    reason: attention.reason,
    runId: paused.request.runId,
    session: paused.session,
    status: "needs_attention",
    task: paused.task,
  };
}

export function reviewOwnsRecovery(snapshot: RunSnapshot | null): boolean {
  const planReview = snapshot?.planComplianceReview;
  const standardsReview = snapshot?.standardsReview;
  if (planReview != null) return planReview.stage !== "repair_attention";
  return (
    standardsReview != null && standardsReview.stage !== "repair_attention"
  );
}

export function recoverableSnapshot(
  snapshot: RunSnapshot | null,
  statuses: readonly RunStatus[],
): RecoverableRun {
  if (snapshot === null || !statuses.includes(snapshot.status)) {
    throw new Error("No recoverable Striker run is active");
  }
  if (snapshot.task === null) {
    throw new Error("Striker run is missing recovery context");
  }
  return {
    attempt: snapshot.attempt ?? 0,
    attention: snapshot.attention ?? null,
    baselineRecorded: snapshot.baselineRecorded ?? false,
    before: snapshot.before ?? undefined,
    planComplianceReview: snapshot.planComplianceReview,
    request: snapshot.request,
    session: snapshot.session,
    standardsReview: snapshot.standardsReview,
    status: snapshot.status as RecoverableRun["status"],
    task: snapshot.task,
  };
}

export function recoverableRun(
  recovery: RunRecoveryState,
  statuses: readonly RunStatus[],
): RecoverableRun {
  return recoverableSnapshot(recovery.snapshot, statuses);
}
