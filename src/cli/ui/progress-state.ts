import type { CheckStage, DashboardStage } from "./progress-stages.js";
import type { BlockingReview, CheckState } from "./progress-stages.js";

export interface PlanTaskSeed {
  readonly id: string;
  readonly title: string;
}

export interface ProgressSeed {
  readonly backend: "docker" | "local";
  readonly plan?: { readonly tasks: readonly PlanTaskSeed[] };
}

export interface ProgressState {
  readonly attempt: number;
  readonly attention: {
    readonly detail: string;
    readonly reason: string;
  } | null;
  readonly backend: "docker" | "local";
  readonly blocked: BlockingReview | null;
  readonly candidate: string | null;
  readonly certified: readonly string[];
  readonly checks: Readonly<Partial<Record<CheckStage, CheckState>>>;
  readonly export: {
    readonly head: string;
    readonly status: "completed" | "failed";
  } | null;
  readonly finished: "completed" | "exhausted" | "failed" | null;
  readonly history: readonly {
    readonly blockers: number;
    readonly round: number;
  }[];
  readonly live: string;
  readonly planId: string | null;
  readonly planTasks: readonly PlanTaskSeed[] | null;
  readonly repairs: readonly string[];
  readonly resolvedRound: number | null;
  readonly runId: string | null;
  readonly session: string | null;
  readonly stage: DashboardStage;
  readonly task: { readonly id: string; readonly title: string } | null;
  readonly tool: string;
}

export const noActivity = "No activity reported";

export function initialProgress(seed: ProgressSeed): ProgressState {
  return {
    attempt: 0,
    attention: null,
    backend: seed.backend,
    blocked: null,
    candidate: null,
    certified: [],
    checks: {},
    export: null,
    finished: null,
    history: [],
    live: "Preparing the execution environment.",
    planId: null,
    planTasks: seed.plan?.tasks ?? null,
    repairs: [],
    resolvedRound: null,
    runId: null,
    session: null,
    stage: "Preparing",
    task: null,
    tool: noActivity,
  };
}

/** A plan parsed after the display began fills the panel without a restart. */
export function withPlan(
  state: ProgressState,
  tasks: readonly PlanTaskSeed[],
): ProgressState {
  return { ...state, planTasks: tasks };
}

/** A new attempt or task restarts display rounds without revoking evidence. */
export function restartRounds(state: ProgressState): ProgressState {
  return {
    ...state,
    attention: null,
    blocked: null,
    candidate: null,
    checks: {},
    history: [],
    repairs: [],
    resolvedRound: null,
  };
}

export function displayRound(state: ProgressState): number {
  return state.repairs.length + 1;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
