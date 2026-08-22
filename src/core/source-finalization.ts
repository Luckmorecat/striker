import type { RunJournal } from "./contracts.js";
import { transitionRun } from "./run-state.js";

export async function finalizeExhaustedSource(
  journal: RunJournal,
  runId: string,
): Promise<void> {
  transitionRun("running", "complete");
  await journal.append({ runId, type: "run_completed" });
}
