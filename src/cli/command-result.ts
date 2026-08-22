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
    const retryOnly =
      result.reason === "run_initialization_interrupted" ||
      result.reason === "session_resume_failed";
    const commands = retryOnly
      ? "Run `striker retry` to start a fresh attempt."
      : "Run `striker answer`, `striker resume`, or `striker retry`.";
    return {
      message: `Run needs attention: ${result.reason}. ${commands}`,
      status: "needs_attention",
    };
  }
  return {
    message: `Run failed: ${result.error}. Run \`striker retry\` or \`striker discard --force\`.`,
    status: "failed",
  };
}
