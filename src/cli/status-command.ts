import { resultExportLines } from "./result-export-output.js";
import type { Command } from "commander";

import type {
  ActiveRunStatus,
  RecoveryOperationHandler,
} from "../core/recovery-operations.js";

interface StatusCommandDependencies {
  readonly handler: RecoveryOperationHandler;
  readonly writeOut: (text: string) => unknown;
}

function renderStatus(status: ActiveRunStatus): string {
  const lines = [
    `Run: ${status.runId}`,
    `Status: ${status.status}`,
    `Task: ${status.task === null ? "none" : `${status.task.id}@${status.task.revision}`}`,
    `Attempt: ${String(status.attempt)}`,
    `Runtime session: ${status.session?.id ?? "none"}`,
    `Provider session: ${status.session?.resumeId ?? "none"}`,
    `Last transition: ${status.lastTransition}`,
  ];
  if (status.attentionReason !== undefined) {
    lines.push(`Attention: ${status.attentionReason}`);
  }
  lines.push(...executionStatusLines(status));
  if (status.resultExport)
    lines.push(...resultExportLines(status.resultExport));
  return `${lines.join("\n")}\n`;
}

export function addStatusCommand(
  program: Command,
  dependencies: StatusCommandDependencies,
): void {
  program
    .command("status")
    .description("Report the active Striker run")
    .action(async () => {
      const status = await dependencies.handler.status();
      dependencies.writeOut(
        status === null ? "No active Striker run.\n" : renderStatus(status),
      );
    });
}

function executionStatusLines(status: ActiveRunStatus): string[] {
  const lines: string[] = [];
  const execution = status.execution;
  if (execution) lines.push(`Execution: ${execution.backend}`);
  if (execution?.imageId) lines.push(`Image: ${execution.imageId}`);
  if (execution?.model)
    lines.push(
      `Model: ${execution.model} (${execution.effort ?? "unspecified"})`,
    );
  if (execution?.artifacts) lines.push(`Artifacts: ${execution.artifacts}`);
  if (execution?.error) lines.push(`Environment: ${execution.error}`);
  if (status.recoveryActions)
    lines.push(`Recovery: ${recoveryInstructions(status.recoveryActions)}`);
  return lines;
}

function recoveryInstructions(
  actions: NonNullable<ActiveRunStatus["recoveryActions"]>,
): string {
  return (
    actions.map((action) => `striker ${action}`).join("; ") ||
    "inspect retained state; no continuation available"
  );
}
