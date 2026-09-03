import type {
  AgentRequest,
  AgentSession,
  GitState,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskIdentity,
  TaskSourceReference,
  VerificationResult,
} from "./execution-contracts.js";
import type { StandardsReviewResult } from "./review-contracts.js";

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
  | "assumption_disproved"
  | "assumption_needs_decision"
  | "plan_compliance_repair_interrupted"
  | "plan_compliance_review_interrupted"
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
  readonly planComplianceReview?: PlanComplianceReviewState | null;
  readonly request: DispatchRequest;
  readonly runId: string;
  readonly session: AgentSession | null;
  readonly status: RunStatus;
  readonly standardsReview?: StandardsReviewState | null;
  readonly task: ImplementationTask | null;
}

export interface PlanComplianceReviewState {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion: TaskCompletionEvidence;
  readonly discoveries?: readonly import("./discovery-contracts.js").ResolvedDiscoveryProposal[];
  readonly outcomeFacts?: readonly import("./outcome-contracts.js").ResolvedOutcomeFactProposal[];
  readonly result:
    import("./review-contracts.js").PlanComplianceReviewResult | null;
  readonly resultCommit: string;
  readonly repairOutput: string | null;
  readonly reviewSession: AgentSession | null;
  readonly stage: ReviewStage;
  readonly standards: import("./review-contracts.js").StandardsReviewResult;
  readonly startCommit: string;
  readonly verification: VerificationResult;
}

export type ReviewStage =
  | "changes_required"
  | "interrupted"
  | "passed"
  | "repaired"
  | "repair_attention"
  | "repair_interrupted"
  | "repairing"
  | "reviewing";

export interface StandardsReviewState {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion: TaskCompletionEvidence;
  readonly result: StandardsReviewResult | null;
  readonly resultCommit: string;
  readonly repairOutput: string | null;
  readonly reviewSession: AgentSession | null;
  readonly stage: ReviewStage;
  readonly startCommit: string;
  readonly verification: VerificationResult;
}

export type RunJournalEvent =
  | {
      readonly decision: import("./review-contracts.js").DiscoveryDecision;
      readonly proposal: import("./discovery-contracts.js").ResolvedDiscoveryProposal;
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly transition: import("./ledger-state.js").PlanLedgerTransition;
      readonly type: "ledger_transition_recorded";
    }
  | {
      readonly answer: string;
      readonly runId: string;
      readonly type: "ledger_attention_answered";
    }
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
      readonly request: AgentRequest;
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
      readonly certification: "independent_reviews" | "standards_review";
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
      readonly attempt: number;
      readonly changedPaths: readonly string[];
      readonly completion: TaskCompletionEvidence;
      readonly discoveries?: readonly import("./discovery-contracts.js").ResolvedDiscoveryProposal[];
      readonly outcomeFacts?: readonly import("./outcome-contracts.js").ResolvedOutcomeFactProposal[];
      readonly resultCommit: string;
      readonly runId: string;
      readonly session: AgentSession;
      readonly standards: import("./review-contracts.js").StandardsReviewResult;
      readonly startCommit: string;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_review_started";
      readonly verification: VerificationResult;
    }
  | {
      readonly result: import("./review-contracts.js").PlanComplianceReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_review_completed";
    }
  | {
      readonly attempt: number;
      readonly attention: RunAttention;
      readonly changedPaths: readonly string[];
      readonly completion: TaskCompletionEvidence;
      readonly discoveries?: readonly import("./discovery-contracts.js").ResolvedDiscoveryProposal[];
      readonly outcomeFacts?: readonly import("./outcome-contracts.js").ResolvedOutcomeFactProposal[];
      readonly resultCommit: string;
      readonly runId: string;
      readonly session: AgentSession | null;
      readonly standards: import("./review-contracts.js").StandardsReviewResult;
      readonly startCommit: string;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_review_interrupted";
      readonly verification: VerificationResult;
    }
  | {
      readonly result: import("./review-contracts.js").PlanComplianceReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_repair_started";
    }
  | {
      readonly attention: RunAttention;
      readonly result: import("./review-contracts.js").PlanComplianceReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_repair_interrupted";
    }
  | {
      readonly output: string;
      readonly result: import("./review-contracts.js").PlanComplianceReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "plan_compliance_repair_completed";
    }
  | {
      readonly result: StandardsReviewResult;
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
      readonly result: StandardsReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_repair_started";
    }
  | {
      readonly attention: RunAttention;
      readonly result: StandardsReviewResult;
      readonly runId: string;
      readonly session: AgentSession;
      readonly task: TaskIdentity;
      readonly type: "standards_repair_interrupted";
    }
  | {
      readonly output: string;
      readonly result: StandardsReviewResult;
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

export interface DiscoveryReviewRecord {
  readonly applied: boolean;
  readonly decision: import("./review-contracts.js").DiscoveryDecision;
  readonly proposal: import("./discovery-contracts.js").ResolvedDiscoveryProposal;
  readonly transition?: import("./ledger-state.js").PlanLedgerTransition;
}

export interface RunRecoveryState {
  readonly completedTasks: readonly TaskIdentity[];
  readonly discoveryReviews?: readonly DiscoveryReviewRecord[];
  readonly lastEvent: RunJournalEvent;
  readonly ledgerTransitions?: readonly Extract<
    RunJournalEvent,
    { readonly type: "ledger_transition_recorded" }
  >[];
  readonly planId: string;
  readonly snapshot: RunSnapshot | null;
}
