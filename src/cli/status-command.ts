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
