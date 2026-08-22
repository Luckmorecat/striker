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

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function taskLabel(task: TaskIdentity): string {
  return `${task.id}@${task.revision}`;
}

function ledgerStatus(
  definitions: PlanQueryDefinition["assumptions"],
): readonly PlanLedgerStatus[] {
  return definitions.map((definition) => ({
    ...definition,
    state: "recorded",
  }));
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
      assumptions: ledgerStatus(plan.assumptions),
      attention: planAttention(recovery, active),
      defaults: ledgerStatus(plan.defaults),
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
