import type { DispatchResult, RunCommandResult } from "../core/contracts.js";

export function commandResult(result: DispatchResult): RunCommandResult {
  if (result.status === "source_exhausted") {
    return {
      message: "Striker plan has no remaining tasks.",
      status: "completed",
    };
  }
  if (result.status === "completed") {
    return {
      message: `Completed ${result.task.identity.id}.`,
      status: "completed",
    };
  }
  if (result.status === "needs_attention") {
    return {
      message: `Run needs attention: ${result.reason}.`,
      reason: result.reason,
      status: "needs_attention",
    };
  }
  return {
    message: `Run failed: ${result.error}.`,
    status: "failed",
  };
}
