import type {
  RunJournalEvent,
  VerificationResult,
} from "../../core/contracts.js";
import type { ReviewResult } from "../../core/review-contracts.js";
import {
  displayRound,
  shortCommit,
  type ProgressState,
} from "./progress-state.js";
import {
  blockerCount,
  type CheckStage,
  type CheckState,
} from "./progress-stages.js";

const reviewEventTypes = [
  "plan_compliance_repair_completed",
  "plan_compliance_repair_interrupted",
  "plan_compliance_repair_started",
  "plan_compliance_review_completed",
  "plan_compliance_review_interrupted",
  "plan_compliance_review_started",
  "standards_repair_completed",
  "standards_repair_interrupted",
  "standards_repair_started",
  "standards_review_completed",
  "standards_review_interrupted",
  "standards_review_started",
] as const;

export type ReviewEvent = Extract<
  RunJournalEvent,
  { readonly type: (typeof reviewEventTypes)[number] }
>;

export function isReviewEvent(event: RunJournalEvent): event is ReviewEvent {
  return (reviewEventTypes as readonly string[]).includes(event.type);
}

function stageOf(event: ReviewEvent): CheckStage {
  return event.type.startsWith("standards")
    ? "Standards review"
    : "Plan review";
}

function passedCheck(
  candidate: string,
  verification: VerificationResult,
): CheckState {
  return {
    blockers: [],
    candidate,
    stale: false,
    verdict: verification.exitCode === 0 ? "passed" : "failed",
  };
}

function reviewedCheck(
  candidate: string,
  findings: readonly string[],
): CheckState {
  return {
    blockers: findings,
    candidate,
    stale: false,
    verdict: findings.length > 0 ? "changes_required" : "passed",
  };
}

function blockingMessages(result: ReviewResult): readonly string[] {
  return result.verdict === "passed"
    ? []
    : result.findings
        .filter((finding) => finding.severity === "blocking")
        .map((finding) => finding.message);
}

function startReview(
  state: ProgressState,
  event: Extract<
    ReviewEvent,
    { type: "plan_compliance_review_started" | "standards_review_started" }
  >,
): ProgressState {
  const stage = stageOf(event);
  // The event carries the standards result; the fold restates no review order.
  const standards =
    event.type === "plan_compliance_review_started"
      ? {
          "Standards review": reviewedCheck(
            event.standards.resultCommit,
            blockingMessages(event.standards),
          ),
        }
      : {};
  return {
    ...state,
    attention: null,
    candidate: event.resultCommit,
    checks: {
      ...state.checks,
      Verifying: passedCheck(event.resultCommit, event.verification),
      ...standards,
      [stage]: {
        blockers: [],
        candidate: event.resultCommit,
        stale: false,
        verdict: null,
      },
    },
    live: `Reviewing candidate ${shortCommit(event.resultCommit)}${stage === "Plan review" ? " against the plan" : " against project standards"}.`,
    stage,
    tool: `Review candidate ${shortCommit(event.resultCommit)}`,
  };
}

function completeReview(
  state: ProgressState,
  event: Extract<
    ReviewEvent,
    { type: "plan_compliance_review_completed" | "standards_review_completed" }
  >,
): ProgressState {
  const stage = stageOf(event);
  const blockers = blockingMessages(event.result);
  const round = displayRound(state);
  const checks = {
    ...state.checks,
    [stage]: reviewedCheck(event.result.resultCommit, blockers),
  };
  if (blockers.length === 0)
    return {
      ...state,
      blocked: state.blocked?.stage === stage ? null : state.blocked,
      checks,
      live: `${stage} passed on candidate ${shortCommit(event.result.resultCommit)}.`,
      resolvedRound:
        state.blocked?.stage === stage ? round : state.resolvedRound,
      stage,
    };
  return {
    ...state,
    blocked: { blockers, round, stage },
    checks,
    history: state.history.some((entry) => entry.round === round)
      ? state.history
      : [...state.history, { blockers: blockers.length, round }],
    live: `${stage} found ${blockerCount(blockers.length, "blocking finding")}. Returning to implementation.`,
    stage,
  };
}

function startRepair(
  state: ProgressState,
  event: Extract<
    ReviewEvent,
    { type: "plan_compliance_repair_started" | "standards_repair_started" }
  >,
): ProgressState {
  const stage = stageOf(event);
  const key = `${String(state.attempt)}|${stage}|${event.result.resultCommit}`;
  const repairs = state.repairs.includes(key)
    ? state.repairs
    : [...state.repairs, key];
  return {
    ...state,
    attention: null,
    checks: staleChecks(state.checks),
    live: `Repairing ${blockerCount(state.blocked?.blockers.length ?? 0, "blocking finding")} · round ${String(repairs.length + 1)}.`,
    repairs,
    stage: "Implementing",
  };
}

/** Display invalidation only: prior evidence keeps its candidate association. */
function staleChecks(checks: ProgressState["checks"]): ProgressState["checks"] {
  return Object.fromEntries(
    Object.entries(checks).map(([stage, check]) => [
      stage,
      check.verdict === null ? check : { ...check, stale: true },
    ]),
  );
}

export function applyReviewEvent(
  state: ProgressState,
  event: ReviewEvent,
): ProgressState {
  switch (event.type) {
    case "plan_compliance_review_started":
    case "standards_review_started":
      return startReview(state, event);
    case "plan_compliance_review_completed":
    case "standards_review_completed":
      return completeReview(state, event);
    case "plan_compliance_repair_started":
    case "standards_repair_started":
      return startRepair(state, event);
    case "plan_compliance_repair_completed":
    case "standards_repair_completed":
      return {
        ...state,
        live: "Repair returned; rechecking the candidate.",
        stage: "Implementing",
      };
    default:
      return {
        ...state,
        attention: {
          detail: event.attention.detail,
          reason: event.attention.reason,
        },
        live: event.attention.detail,
      };
  }
}
