import {
  displayRound,
  shortCommit,
  type PlanTaskSeed,
  type ProgressState,
} from "./progress-state.js";
import {
  findings,
  pipeline,
  type DashboardStage,
  type FindingsPanel,
  type PipelineStage,
} from "./progress-stages.js";

export interface PlanTaskLine extends PlanTaskSeed {
  readonly state: "active" | "certified" | "pending";
}

export interface DashboardModel {
  readonly attention: {
    readonly detail: string;
    readonly reason: string;
  } | null;
  readonly detail: string;
  readonly export: {
    readonly head: string;
    readonly status: "completed" | "failed";
  } | null;
  readonly findings: FindingsPanel | null;
  readonly finished: "completed" | "exhausted" | "failed" | null;
  readonly live: string;
  readonly pipeline: readonly PipelineStage[];
  readonly plan: {
    readonly certified: number;
    readonly tasks: readonly PlanTaskLine[];
    readonly total: number | null;
  };
  readonly round: number;
  readonly session: {
    readonly attempt: number;
    readonly backend: string;
    readonly effort: string | null;
    readonly id: string | null;
    readonly model: string | null;
  };
  readonly stage: DashboardStage;
  readonly tool: string;
}

const backendLabels = { docker: "Docker", local: "Local" };

function planTasks(state: ProgressState): readonly PlanTaskLine[] {
  const seeded =
    state.planTasks ??
    [...new Set([...state.certified, state.task?.id])]
      .filter((id): id is string => id !== undefined)
      .map((id) => ({
        id,
        title: id === state.task?.id ? state.task.title : "",
      }));
  return seeded.map((task) => ({
    ...task,
    state: state.certified.includes(task.id)
      ? "certified"
      : task.id === state.task?.id
        ? "active"
        : "pending",
  }));
}

export function dashboardModel(state: ProgressState): DashboardModel {
  return {
    attention: state.attention,
    detail: dashboardDetail(state),
    export: state.export,
    findings: findings({
      blocked: state.blocked,
      history: state.history,
      rechecking:
        state.blocked !== null &&
        state.checks[state.blocked.stage]?.verdict === null,
      resolvedRound: state.resolvedRound,
    }),
    finished: state.finished,
    live: state.live,
    pipeline: pipeline({
      attention: state.attention !== null,
      checks: state.checks,
      finished: state.finished,
      round: displayRound(state),
      stage: state.stage,
    }),
    plan: {
      certified: state.certified.length,
      tasks: planTasks(state),
      total: state.planTasks?.length ?? null,
    },
    round: displayRound(state),
    session: {
      attempt: state.attempt,
      backend: backendLabels[state.backend],
      effort: state.selection.effort,
      id: state.session,
      model: state.selection.model,
    },
    stage: state.stage,
    tool: state.tool,
  };
}

function dashboardDetail(state: ProgressState): string {
  return [
    `Round ${String(displayRound(state))}`,
    `attempt ${String(state.attempt)}`,
    ...(state.candidate === null
      ? []
      : [`candidate ${shortCommit(state.candidate)}`]),
    ...(state.export === null
      ? []
      : [`export ${state.export.status} ${shortCommit(state.export.head)}`]),
  ].join(" · ");
}
