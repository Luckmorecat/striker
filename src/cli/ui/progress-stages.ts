export const dashboardStages = [
  "Preparing",
  "Implementing",
  "Verifying",
  "Standards review",
  "Plan review",
  "Completed",
] as const;

export type DashboardStage = (typeof dashboardStages)[number];
export type CheckStage = Extract<
  DashboardStage,
  "Plan review" | "Standards review" | "Verifying"
>;

export type StageState =
  "active" | "attention" | "blocked" | "passed" | "pending" | "recheck";

export interface PipelineStage {
  readonly note: string | null;
  readonly stage: DashboardStage;
  readonly state: StageState;
}

/** One authoritative result per candidate; a repair marks it needing recheck. */
export interface CheckState {
  readonly blockers: readonly string[];
  readonly candidate: string | null;
  readonly stale: boolean;
  readonly verdict: "changes_required" | "failed" | "passed" | null;
}

export interface BlockingReview {
  readonly blockers: readonly string[];
  readonly round: number;
  readonly stage: CheckStage;
}

export interface FindingsPanel {
  readonly headline: string;
  readonly items: readonly string[];
  readonly status: "blocking" | "rechecking" | "resolved";
}

export interface StageInput {
  readonly attention: boolean;
  readonly checks: Readonly<Partial<Record<CheckStage, CheckState>>>;
  readonly finished: "completed" | "exhausted" | "failed" | null;
  readonly round: number;
  readonly stage: DashboardStage;
}

export const emptyCheck: CheckState = {
  blockers: [],
  candidate: null,
  stale: false,
  verdict: null,
};

export function blockerCount(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function checkNote(check: CheckState): PipelineStage["state"] | null {
  if (check.stale) return check.blockers.length > 0 ? "blocked" : "recheck";
  if (check.verdict === "changes_required" || check.verdict === "failed")
    return "blocked";
  // An authoritative passing result outranks "still the newest stage".
  return check.verdict === "passed" ? "passed" : null;
}

function markedStage(
  stage: DashboardStage,
  check: CheckState,
): PipelineStage | null {
  const state = checkNote(check);
  if (state === null) return null;
  if (state === "passed") return { note: null, stage, state };
  if (state === "recheck")
    return { note: "recheck required", stage, state: "recheck" };
  if (check.stale) return { note: "recheck due", stage, state: "blocked" };
  return {
    note:
      check.verdict === "failed"
        ? "failed"
        : blockerCount(check.blockers.length, "blocker"),
    stage,
    state: "blocked",
  };
}

function activeStage(input: StageInput, stage: DashboardStage): PipelineStage {
  if (input.attention)
    return { note: "needs attention", stage, state: "attention" };
  if (input.finished === "failed")
    return { note: "run failed", stage, state: "blocked" };
  // Nothing ran past here, so no stage turns green.
  if (input.finished === "exhausted")
    return { note: "no task to certify", stage, state: "pending" };
  return {
    note: input.round > 1 ? `round ${String(input.round)}` : null,
    stage,
    state: "active",
  };
}

export function pipeline(input: StageInput): readonly PipelineStage[] {
  if (input.finished === "completed")
    return dashboardStages.map((stage) => ({
      note: null,
      stage,
      state: "passed" as const,
    }));
  const reached = dashboardStages.indexOf(input.stage);
  return dashboardStages.map((stage, index) => {
    const marked = markedStage(
      stage,
      input.checks[stage as CheckStage] ?? emptyCheck,
    );
    if (marked !== null) return marked;
    if (index === reached && stage !== "Completed")
      return activeStage(input, stage);
    return {
      note: null,
      stage,
      state: index <= reached ? "passed" : ("pending" as const),
    };
  });
}

export interface FindingsInput {
  readonly blocked: BlockingReview | null;
  readonly history: readonly {
    readonly blockers: number;
    readonly round: number;
  }[];
  /** A later candidate is under review for the stage that reported blockers. */
  readonly rechecking: boolean;
  readonly resolvedRound: number | null;
}

function resolvedHeadline(input: FindingsInput): string {
  const rounds = input.history.map(
    (entry) =>
      `round ${String(entry.round)}: ${blockerCount(entry.blockers, "blocker")}`,
  );
  return `✓ Review history · ${[...rounds, `round ${String(input.resolvedRound ?? 0)}: resolved`].join(" → ")}`;
}

export function findings(input: FindingsInput): FindingsPanel | null {
  const blocked = input.blocked;
  if (blocked === null) {
    if (input.resolvedRound === null || input.history.length === 0) return null;
    return { headline: resolvedHeadline(input), items: [], status: "resolved" };
  }
  const items = blocked.blockers.map((message) => `  • ${message}`);
  return input.rechecking
    ? {
        headline: `RECHECKING · ${blockerCount(blocked.blockers.length, "finding")} from round ${String(blocked.round)}`,
        items,
        status: "rechecking",
      }
    : {
        headline: `! REVIEW · ${blockerCount(blocked.blockers.length, "blocking finding")} from round ${String(blocked.round)}`,
        items,
        status: "blocking",
      };
}
