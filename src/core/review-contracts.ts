import type { AgentSession } from "./execution-contracts.js";

export interface ReviewFinding {
  readonly fix: string;
  readonly kind: "defect" | "plan_violation" | "rule_violation";
  readonly location: {
    readonly line: number;
    readonly endLine?: number;
  };
  readonly message: string;
  readonly path: string;
  readonly rule: string;
  readonly severity: "advisory" | "blocking";
}

interface ReviewResultBase {
  readonly findings: readonly ReviewFinding[];
  readonly resultCommit: string;
  readonly startCommit: string;
  readonly verdict: "changes_required" | "passed";
}

export interface StandardsReviewResult extends ReviewResultBase {
  readonly kind: "standards";
}

export interface PlanComplianceReviewResult extends ReviewResultBase {
  readonly discoveryDecisions: readonly DiscoveryDecision[];
  readonly kind: "plan_compliance";
  readonly outcomeFactDecisions: readonly OutcomeFactDecision[];
}

export interface OutcomeFactDecision {
  readonly decision: "accepted" | "rejected";
  readonly id: string;
  readonly reason: string;
}

export interface DiscoveryDecision {
  readonly decision: "accepted" | "rejected";
  readonly id: string;
  readonly kind: "assumption" | "default";
  readonly reason: string;
}

export type ReviewResult = PlanComplianceReviewResult | StandardsReviewResult;

export interface ReviewRequest {
  readonly instructions: string;
}

export type ReviewTurn =
  | {
      readonly status: "returned";
      readonly session: AgentSession;
      readonly result: ReviewResult;
    }
  | {
      readonly status: "failed";
      readonly session: AgentSession;
      readonly error: string;
    };
