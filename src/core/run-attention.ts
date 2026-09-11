export type AttentionReason =
  | "execution_resource_exhausted"
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
  | "task_outcome_conflict"
  | "task_outcome_limit_exceeded"
  | "verification_failed";

export interface RunAttention {
  readonly detail: string;
  readonly reason: AttentionReason;
}
