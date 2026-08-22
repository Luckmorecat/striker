import type {
  DispatchRequest,
  GitState,
  ImplementationTask,
  RunAttention,
  RunRecoveryState,
  RunSnapshot,
  RunStatus,
} from "./contracts.js";

export interface RecoverableRun {
  readonly attempt: number;
  readonly attention: RunAttention | null;
  readonly baselineRecorded: boolean;
  readonly before: GitState | undefined;
  readonly request: DispatchRequest;
  readonly session: RunSnapshot["session"];
  readonly standardsReview: RunSnapshot["standardsReview"];
  readonly status: "failed" | "needs_attention" | "running";
  readonly task: ImplementationTask;
}

export function reviewOwnsRecovery(
  snapshot: RunSnapshot | null,
): snapshot is RunSnapshot & {
  readonly standardsReview: NonNullable<RunSnapshot["standardsReview"]>;
} {
  const review = snapshot?.standardsReview;
  return review != null && review.stage !== "repair_attention";
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
