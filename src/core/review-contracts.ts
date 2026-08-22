import type { AgentSession } from "./execution-contracts.js";

export interface ReviewFinding {
  readonly fix: string;
  readonly kind: "defect" | "rule_violation";
  readonly location: {
    readonly line: number;
    readonly endLine?: number;
  };
  readonly message: string;
  readonly path: string;
  readonly rule: string;
  readonly severity: "advisory" | "blocking";
}

export interface ReviewResult {
  readonly findings: readonly ReviewFinding[];
  readonly kind: "standards";
  readonly resultCommit: string;
  readonly startCommit: string;
  readonly verdict: "changes_required" | "passed";
}

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
