import type {
  PlanLedgerStatus,
  PlanAttention,
  PlanLogReader,
  PlanQueryDefinition,
  PlanReviewStatus,
  PlanStatus,
  PlanTaskStatus,
  RunJournal,
  RunRecoveryState,
  RunSnapshot,
  TaskIdentity,
} from "./contracts.js";
import {
  createLedgerState,
  ledgerTransitionPause,
  transitionLedger,
} from "./ledger-state.js";

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function taskLabel(task: TaskIdentity): string {
  return `${task.id}@${task.revision}`;
}

type LedgerEvent = NonNullable<RunRecoveryState["ledgerTransitions"]>[number];
type DiscoveryReview = NonNullable<
  RunRecoveryState["discoveryReviews"]
>[number];

function ledgerEvidence(
  event: LedgerEvent | undefined,
  review: DiscoveryReview | undefined,
): Partial<PlanLedgerStatus> {
  if (review !== undefined) {
    return formatLedgerEvidence(
      review.proposal,
      review.decision,
      review.transition,
      review.applied,
    );
  }
  if (event !== undefined) {
    return formatLedgerEvidence(
      event.proposal,
      event.decision,
      event.transition,
      true,
    );
  }
  return {};
}

function pauseEvidence(
  transition: DiscoveryReview["transition"],
  applied: boolean,
  reason: string,
): Partial<PlanLedgerStatus> {
  if (!applied || transition === undefined) return {};
  const pause = ledgerTransitionPause(transition, reason);
  return pause === null ? {} : { pauseReason: pause.reason };
}

function formatLedgerEvidence(
  proposal: DiscoveryReview["proposal"],
  decision: DiscoveryReview["decision"],
  transition: DiscoveryReview["transition"],
  applied: boolean,
): Partial<PlanLedgerStatus> {
  const proposalText =
    proposal.kind === "assumption" ? proposal.reason : proposal.deviation;
  return {
    applied,
    decision: decision.decision,
    ...(proposal.kind === "default" ? { deviation: proposal.deviation } : {}),
    locator: proposal.locator,
    ...pauseEvidence(transition, applied, decision.reason),
    proposal: proposalText,
    reason: decision.reason,
  };
}

function ledgerStatus(
  definitions: PlanQueryDefinition["assumptions"],
  kind: "assumption" | "default",
  recovery: RunRecoveryState | null,
): readonly PlanLedgerStatus[] {
  let state = createLedgerState({
    assumptions: kind === "assumption" ? definitions.map(({ id }) => id) : [],
    defaults: kind === "default" ? definitions.map(({ id }) => id) : [],
  });
  const evidence = new Map<
    string,
    NonNullable<RunRecoveryState["ledgerTransitions"]>[number]
  >();
  for (const event of recovery?.ledgerTransitions ?? []) {
    if (event.transition.kind !== kind) continue;
    const result = transitionLedger(state, event.transition);
    state = result.state;
    if (result.applied) evidence.set(event.transition.id, event);
  }
  const states = kind === "assumption" ? state.assumptions : state.defaults;
  const reviews = new Map(
    (recovery?.discoveryReviews ?? [])
      .filter((record) => record.proposal.kind === kind)
      .map((record) => [record.proposal.id, record]),
  );
  return definitions.map((definition) => {
    const event = evidence.get(definition.id);
    const review = reviews.get(definition.id);
    return {
      ...definition,
      ...ledgerEvidence(event, review),
      state: states[definition.id] ?? "recorded",
    };
  });
}

function activeSnapshot(recovery: RunRecoveryState | null): RunSnapshot | null {
  const snapshot = recovery?.snapshot ?? null;
  return snapshot === null ||
    snapshot.status === "completed" ||
    snapshot.status === "discarded"
    ? null
    : snapshot;
}

function planAttention(
  recovery: RunRecoveryState | null,
  active: RunSnapshot | null,
): PlanAttention | null {
  const lastEvent = recovery?.lastEvent;
  if (lastEvent?.type !== "run_source_changed") {
    return active?.attention ?? null;
  }
  const current =
    lastEvent.current === null ? "no task" : taskLabel(lastEvent.current);
  return {
    detail: `Completed task ${taskLabel(lastEvent.task)} now resolves to ${current}.`,
    reason: "completed_task_changed",
  };
}

function reviewStatus(
  completed: readonly TaskIdentity[],
): readonly PlanReviewStatus[] {
  return completed.map((task) => ({
    plan: "passed",
    standards: "passed",
    task,
  }));
}

function taskStatus(
  task: TaskIdentity,
  recovery: RunRecoveryState | null,
  active: RunSnapshot | null,
): PlanTaskStatus {
  const completed =
    recovery?.completedTasks.some((candidate) => sameTask(candidate, task)) ??
    false;
  const selected =
    active?.task !== null && active?.task !== undefined
      ? sameTask(active.task.identity, task)
      : false;
  return {
    ...task,
    state: completed ? "completed" : selected ? "active" : "pending",
  };
}

export class PlanQueries {
  constructor(
    private readonly journal: RunJournal,
    private readonly logReader: PlanLogReader,
  ) {}

  async status(plan: PlanQueryDefinition): Promise<PlanStatus> {
    const recovery = await this.journal.load(plan.planId);
    const active = activeSnapshot(recovery);
    return {
      activeRun:
        active === null
          ? null
          : { attempt: active.attempt ?? null, runId: active.runId },
      assumptions: ledgerStatus(plan.assumptions, "assumption", recovery),
      attention: planAttention(recovery, active),
      defaults: ledgerStatus(plan.defaults, "default", recovery),
      planId: plan.planId,
      reviews: reviewStatus(recovery?.completedTasks ?? []),
      status: recovery?.snapshot?.status ?? "not_started",
      tasks: plan.tasks.map((task) => taskStatus(task, recovery, active)),
    };
  }

  async log(planId: string): Promise<string> {
    const recovery = await this.journal.load(planId);
    return this.logReader.read(recovery === null ? null : planId);
  }
}
