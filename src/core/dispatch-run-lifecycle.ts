import type { DispatchRequest, RunJournal, TaskIdentity } from "./contracts.js";
import { transitionRun } from "./run-state.js";

export async function loadCompletedTasks(
  journal: RunJournal,
  request: DispatchRequest,
): Promise<TaskIdentity[]> {
  const completed = [...request.completedTasks];
  const recovery = await journal.load(request.planId);
  for (const identity of recovery?.completedTasks ?? []) {
    const known = completed.some(
      (item) => item.id === identity.id && item.revision === identity.revision,
    );
    if (!known) completed.push(identity);
  }
  return completed;
}

export async function ensureRunStarted(
  journal: RunJournal,
  request: DispatchRequest,
): Promise<void> {
  const active = await journal.loadActive();
  if (active !== null) {
    if (active.snapshot === null) {
      throw new Error("Active Striker run is missing recovery state");
    }
    if (
      active.planId !== request.planId ||
      active.snapshot.runId !== request.runId
    ) {
      throw new Error(
        `Another Striker run is active: ${active.snapshot.runId}`,
      );
    }
    return;
  }
  transitionRun("created", "start");
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
}
