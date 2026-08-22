import type {
  AgentSession,
  GitState,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSourceReference,
} from "./execution-contracts.js";

export type RunStatus =
  | "created"
  | "running"
  | "needs_attention"
  | "failed"
  | "completed"
  | "discarded";

export type AttentionReason =
  | "completion_evidence_missing"
  | "commit_evidence_missing"
  | "dirty_final_state"
  | "human_log_missing"
  | "review_evidence_missing"
  | "run_initialization_interrupted"
  | "session_resume_failed"
  | "verification_failed";

export interface RunAttention {
  readonly detail: string;
  readonly reason: AttentionReason;
}

export type RunTransition =
  | "start"
  | "complete_task"
  | "complete"
  | "discard"
  | "request_attention"
  | "fail"
  | "answer"
  | "resume"
  | "retry";

export interface DispatchRequest {
  readonly allowDirty?: boolean;
  readonly completedTasks: readonly TaskIdentity[];
  readonly planId: string;
  readonly runId: string;
  readonly skills: readonly string[];
  readonly taskSource: TaskSourceReference;
}

export interface RunSnapshot {
  readonly attempt?: number;
  readonly attention?: RunAttention | null;
  readonly baselineRecorded?: boolean;
  readonly before?: GitState | null;
  readonly planId: string;
  readonly request: DispatchRequest;
  readonly runId: string;
  readonly session: AgentSession | null;
  readonly status: RunStatus;
  readonly task: ImplementationTask | null;
}

export type RunJournalEvent =
  | {
      readonly type: "run_started";
      readonly planId: string;
      readonly request: DispatchRequest;
      readonly runId: string;
    }
  | {
      readonly type: "task_selected";
      readonly runId: string;
      readonly task: ImplementationTask;
    }
  | {
      readonly type: "task_baseline_recorded";
      readonly before: GitState | null;
      readonly runId: string;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "task_attempt_started";
      readonly attempt: number;
      readonly runId: string;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "task_session_started";
      readonly attempt: number;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_retried";
      readonly attempt: number;
      readonly runId: string;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "task_completed";
      readonly evidence?: TaskCompletionEvidence;
      readonly execution?: TaskExecutionEvidence;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_needs_attention";
      readonly attention: RunAttention;
      readonly runId: string;
      readonly session: AgentSession | null;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_answered";
      readonly answer: string;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_resumed";
      readonly attention?: RunAttention;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_failed";
      readonly error: string;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
    }
  | {
      readonly type: "run_source_changed";
      readonly current: TaskIdentity | null;
      readonly runId: string;
      readonly task: TaskIdentity;
    }
  | { readonly type: "run_completed"; readonly runId: string }
  | { readonly type: "run_discarded"; readonly runId: string };

export interface RunJournal {
  append(event: RunJournalEvent): Promise<void>;
  load(planId: string): Promise<RunRecoveryState | null>;
  loadActive(): Promise<RunRecoveryState | null>;
}

export interface RunRecoveryState {
  readonly completedTasks: readonly TaskIdentity[];
  readonly lastEvent: RunJournalEvent;
  readonly planId: string;
  readonly snapshot: RunSnapshot | null;
}
