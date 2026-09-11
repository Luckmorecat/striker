import type {
  AgentSession,
  AttentionReason,
  RunCommandResult,
  RunJournalEvent,
  RunStatus,
  TaskIdentity,
} from "./contracts.js";

export interface ActiveRunStatus {
  readonly execution?: {
    readonly backend: "local" | "docker";
    readonly imageId?: string;
    readonly model?: string;
    readonly effort?: string;
    readonly artifacts?: string;
    readonly error?: string;
  };
  readonly recoveryActions?: readonly import("./recovery-policy.js").RecoveryAction[];
  readonly resultExport?: import("./result-export.js").ResultExportState;
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
    readonly reason: AttentionReason | "completed_task_changed" | "failed";
    readonly detail: string;
  } | null;
  /** Null means a useful continuation; strings explain omitted operations. */
  readonly availability: Readonly<
    Record<import("./recovery-policy.js").RecoveryAction, string | null>
  >;
}

export interface RecoveryInspector {
  inspectRecovery(): Promise<RecoveryInspection | null>;
}
