import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";
import type { RunSnapshot } from "../core/contracts.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { FileRunHistoryReader } from "../infrastructure/run-history-reader.js";
import { readExecutionStatus } from "./execution-status.js";
import {
  recoveryProgressContext,
  type RunProgressContext,
} from "./ui/run-progress.js";

function backendOf(
  snapshot: RunSnapshot | null | undefined,
): "docker" | "local" {
  return snapshot?.request.execution?.backend === "docker" ? "docker" : "local";
}

/**
 * What the dashboard shows for a run that is already paused: the journal's own
 * history, the plan when it still parses, and the model and effort this run
 * recorded. A fact no backend recorded stays missing rather than becoming the
 * current default.
 */
export async function recoveryDisplayContext(
  stateRoot: string,
): Promise<RunProgressContext> {
  const active = await new FileRunJournal(stateRoot).loadActive();
  const status = await readExecutionStatus(stateRoot);
  return recoveryProgressContext({
    backend: backendOf(active?.snapshot),
    history: new FileRunHistoryReader(new FileRunJournal(stateRoot)),
    location: active?.snapshot?.request.taskSource.location,
    parsePlan: parseStrikerPlan,
    selection: {
      effort: status?.execution?.effort ?? null,
      model: status?.execution?.model ?? null,
    },
  });
}
