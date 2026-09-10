import type {
  AgentSession,
  AttentionReason,
  RunCommandResult,
  RunJournalEvent,
  RunStatus,
  TaskIdentity,
} from "./contracts.js";

export interface ActiveRunStatus {
  readonly attempt: number;
  readonly attentionReason?: AttentionReason | "completed_task_changed";
  readonly lastTransition: RunJournalEvent["type"];
  readonly runId: string;
  readonly session: AgentSession | null;
  readonly status: Exclude<RunStatus, "completed">;
  readonly task: TaskIdentity | null;
}

export interface RecoveryOperationHandler {
  discard(): Promise<void>;
  retry(): Promise<RunCommandResult>;
  status(): Promise<ActiveRunStatus | null>;
}

export interface RecoveryInspection {
  readonly runId: string;
  readonly status: RunStatus;
  readonly task: {
    readonly identity: TaskIdentity;
    readonly title: string;
  } | null;
  readonly attention: {
    readonly reason: string;
    readonly detail: string;
  } | null;
  readonly availability: Readonly<
    Record<import("./recovery-policy.js").RecoveryAction, string | null>
  >;
}

export interface RecoveryInspector {
  inspectRecovery(): Promise<RecoveryInspection | null>;
}
