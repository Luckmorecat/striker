import type { RunJournal, TaskIdentity, TaskSource } from "./contracts.js";
import { transitionRun } from "./run-state.js";

export async function finalizeExhaustedSource(
  journal: RunJournal,
  runId: string,
  source: TaskSource,
  completed: readonly TaskIdentity[],
): Promise<void> {
  await source.finalizeCompleted?.(completed);
  if ((await journal.load(runId)) === null) return;
  transitionRun("running", "complete");
  await journal.delete(runId);
}
