import type { RunSnapshot, RunJournalEvent } from "../core/contracts.js";
import { resultBranchName } from "../core/result-export.js";
export function startSnapshot(
  event: Extract<RunJournalEvent, { type: "run_started" }>,
): RunSnapshot {
  const { planId, request } = event;
  if (request.runId !== event.runId) {
    throw new Error("Striker run start contains a mismatched request");
  }
  if (request.planId !== planId) {
    throw new Error("Striker run start contains a mismatched plan identity");
  }
  return {
    ...(request.execution
      ? {
          resultExport: {
            branch: resultBranchName(event.runId),
            head: null,
            pending: null,
            error: null,
          },
        }
      : {}),
    attention: null,
    baselineRecorded: false,
    before: null,
    planId,
    preparedRequest: null,
    request,
    runId: event.runId,
    session: null,
    status: "running",
    task: null,
  };
}
