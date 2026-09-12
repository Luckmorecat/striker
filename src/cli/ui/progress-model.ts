import type { RunJournalEvent } from "../../core/contracts.js";
import type { RunObservation } from "../../core/run-observation.js";
import { applyReviewEvent, isReviewEvent } from "./progress-reviews.js";
import {
  displayRound,
  noActivity,
  restartRounds,
  shortCommit,
  withActivity,
  type PlanTaskSeed,
  type ProgressState,
} from "./progress-state.js";
import {
  emptyCheck,
  findings,
  pipeline,
  type DashboardStage,
  type FindingsPanel,
  type PipelineStage,
} from "./progress-stages.js";

export { initialProgress, withPlan } from "./progress-state.js";
export type {
  PlanTaskSeed,
  ProgressSeed,
  ProgressState,
} from "./progress-state.js";
export { dashboardStages } from "./progress-stages.js";
export type {
  DashboardStage,
  FindingsPanel,
  PipelineStage,
  StageState,
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
    readonly id: string | null;
  };
  readonly stage: DashboardStage;
  readonly tool: string;
}

const backendLabels = { docker: "Docker", local: "Local" };

function applyPreparation(
  state: ProgressState,
  observation: Extract<RunObservation, { kind: "preparation" }>,
): ProgressState {
  return {
    ...state,
    attention:
      observation.phase === "failed"
        ? { detail: observation.detail, reason: "preparation_failed" }
        : state.attention,
    live: observation.detail,
  };
}

function applyVerification(
  state: ProgressState,
  observation: Extract<RunObservation, { kind: "verification" }>,
): ProgressState {
  if (observation.phase === "started")
    return {
      ...state,
      checks: { ...state.checks, Verifying: emptyCheck },
      live: `Verifying with ${observation.command}.`,
      stage: "Verifying",
      tool: `Run ${observation.command}`,
    };
  const { exitCode } = observation;
  return {
    ...state,
    checks: {
      ...state.checks,
      Verifying: {
        ...emptyCheck,
        verdict:
          exitCode === undefined ? null : exitCode === 0 ? "passed" : "failed",
      },
    },
    live:
      exitCode === 0
        ? "Verification passed."
        : `Verification exited with code ${String(exitCode ?? "unknown")}.`,
  };
}

function applyCompletion(
  state: ProgressState,
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): ProgressState {
  const reviewed = {
    blockers: [],
    candidate: event.resultCommit,
    stale: false,
    verdict: "passed" as const,
  };
  return {
    ...state,
    certified: [...state.certified, event.task.id],
    checks: {
      Verifying: {
        ...reviewed,
        verdict: event.verification.exitCode === 0 ? "passed" : "failed",
      },
      "Standards review": reviewed,
      ...(event.certification === "independent_reviews"
        ? { "Plan review": reviewed }
        : {}),
    },
    live: `Certified task ${event.task.id} after ${String(displayRound(state))} implementation round${displayRound(state) === 1 ? "" : "s"}.`,
    stage: "Completed",
    tool: `Commit ${shortCommit(event.resultCommit)}`,
  };
}

function applyRecovery(
  state: ProgressState,
  event: Extract<
    RunJournalEvent,
    {
      type:
        "run_answered" | "run_needs_attention" | "run_resumed" | "run_retried";
    }
  >,
): ProgressState {
  if (event.type === "run_needs_attention")
    return {
      ...state,
      attention: {
        detail: event.attention.detail,
        reason: event.attention.reason,
      },
      live: event.attention.detail,
    };
  if (event.type === "run_retried")
    return {
      ...restartRounds(state),
      attempt: event.attempt,
      live: `Retrying task ${event.task.id} · attempt ${String(event.attempt)}.`,
      stage: "Implementing",
    };
  return {
    ...state,
    attention: null,
    live:
      event.type === "run_answered"
        ? `Applying your decision · round ${String(displayRound(state))}.`
        : "Resuming the interrupted operation.",
    stage: state.stage === "Preparing" ? "Implementing" : state.stage,
  };
}

function applyLifecycle(
  state: ProgressState,
  event: RunJournalEvent,
): ProgressState {
  switch (event.type) {
    case "run_started":
      return {
        ...state,
        live: "Run started.",
        planId: event.planId,
        runId: event.runId,
      };
    case "task_selected":
      return {
        ...restartRounds(state),
        live: `Selected task ${event.task.identity.id}: ${event.task.title}`,
        task: { id: event.task.identity.id, title: event.task.title },
        tool: noActivity,
      };
    case "task_attempt_started":
      return {
        ...restartRounds(state),
        attempt: event.attempt,
        live: `Starting attempt ${String(event.attempt)} on task ${event.task.id}.`,
        stage: "Implementing",
      };
    case "task_session_started":
      return {
        ...state,
        attention: null,
        live: `Implementing task ${event.task.id} · round ${String(displayRound(state))}.`,
        session: event.session.id,
        stage: "Implementing",
      };
    case "task_completed":
      return applyCompletion(state, event);
    default:
      return applyOutcome(state, event);
  }
}

/** Preparation completed; an exhausted run notes the first stage that never ran. */
function exhaustedStage(stage: DashboardStage): DashboardStage {
  return stage === "Preparing" ? "Implementing" : stage;
}

/** Task completion, run completion and export outcome stay distinct facts. */
function applyOutcome(
  state: ProgressState,
  event: RunJournalEvent,
): ProgressState {
  const certified = state.certified.length > 0;
  switch (event.type) {
    case "run_completed":
      return {
        ...state,
        finished: certified ? "completed" : "exhausted",
        live: certified
          ? "Run completed."
          : "Run completed with no task to certify.",
        stage: certified ? "Completed" : exhaustedStage(state.stage),
      };
    case "run_failed":
      return {
        ...state,
        finished: "failed",
        live: `Run failed: ${event.error}`,
      };
    case "result_export_completed":
    case "result_export_failed":
      return {
        ...state,
        export: {
          head: event.head,
          status:
            event.type === "result_export_completed" ? "completed" : "failed",
        },
      };
    case "run_source_changed":
      return {
        ...state,
        attention: {
          detail: `Completed task ${event.task.id} no longer resolves to the same revision.`,
          reason: "completed_task_changed",
        },
      };
    default:
      return state;
  }
}

export function applyObservation(
  state: ProgressState,
  observation: RunObservation,
): ProgressState {
  if (observation.kind === "activity") return withActivity(state, observation);
  if (observation.kind === "preparation")
    return applyPreparation(state, observation);
  if (observation.kind === "verification")
    return applyVerification(state, observation);
  const { event } = observation;
  if (isReviewEvent(event)) return applyReviewEvent(state, event);
  if (
    event.type === "run_answered" ||
    event.type === "run_needs_attention" ||
    event.type === "run_resumed" ||
    event.type === "run_retried"
  )
    return applyRecovery(state, event);
  return applyLifecycle(state, event);
}

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
      id: state.session,
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
