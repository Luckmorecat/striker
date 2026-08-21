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
