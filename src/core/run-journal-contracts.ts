import type {
  AgentSession,
  GitState,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskIdentity,
  TaskSourceReference,
  VerificationResult,
} from "./execution-contracts.js";
import type { ReviewResult } from "./review-contracts.js";

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
  | "review_evidence_missing"
  | "run_initialization_interrupted"
  | "session_resume_failed"
  | "standards_repair_interrupted"
  | "standards_review_interrupted"
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
  readonly standardsReview?: StandardsReviewState | null;
  readonly task: ImplementationTask | null;
}

export interface StandardsReviewState {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion: TaskCompletionEvidence;
  readonly result: ReviewResult | null;
  readonly resultCommit: string;
  readonly repairOutput: string | null;
  readonly reviewSession: AgentSession | null;
  readonly stage:
    | "changes_required"
    | "interrupted"
    | "passed"
    | "repaired"
    | "repair_attention"
    | "repair_interrupted"
    | "repairing"
    | "reviewing";
  readonly startCommit: string;
  readonly verification: VerificationResult;
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
      readonly attempt: number;
      readonly certification: "legacy" | "standards_review";
      readonly changedPaths: readonly string[];
      readonly completedAt: string;
      readonly resultCommit: string;
      readonly startCommit: string;
      readonly type: "task_completed";
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly verification: VerificationResult;
    }
  | {
      readonly attempt: number;
      readonly changedPaths: readonly string[];
      readonly completion: TaskCompletionEvidence;
      readonly resultCommit: string;
      readonly runId: string;
      readonly session: AgentSession;
      readonly startCommit: string;
      readonly task: TaskIdentity;
      readonly type: "standards_review_started";
      readonly verification: VerificationResult;
    }
  | {
      readonly result: ReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_review_completed";
    }
  | {
      readonly attempt: number;
      readonly attention: RunAttention;
      readonly changedPaths: readonly string[];
      readonly completion: TaskCompletionEvidence;
      readonly resultCommit: string;
      readonly runId: string;
      readonly session: AgentSession | null;
      readonly startCommit: string;
      readonly task: TaskIdentity;
      readonly type: "standards_review_interrupted";
      readonly verification: VerificationResult;
    }
  | {
      readonly result: ReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_repair_started";
    }
  | {
      readonly attention: RunAttention;
      readonly result: ReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_repair_interrupted";
    }
  | {
      readonly output: string;
      readonly result: ReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_repair_completed";
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
