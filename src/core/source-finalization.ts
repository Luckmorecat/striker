import type { RunJournal, TaskIdentity, TaskSource } from "./contracts.js";
import { transitionRun } from "./run-state.js";

export async function finalizeExhaustedSource(
  journal: RunJournal,
  runId: string,
  source: TaskSource,
  completed: readonly TaskIdentity[],
): Promise<void> {
  await source.finalizeCompleted?.(completed);
  transitionRun("running", "complete");
  await journal.append({ runId, type: "run_completed" });
}
