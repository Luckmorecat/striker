import type { Command } from "commander";

import type { RecoveryOperationHandler } from "../core/recovery-operations.js";

interface RetryCommandDependencies {
  readonly handler: RecoveryOperationHandler;
  readonly writeOut: (text: string) => unknown;
}

export function addRetryCommand(
  program: Command,
  dependencies: RetryCommandDependencies,
): void {
  program
    .command("retry")
    .description("Retry the active task in a fresh agent session")
    .action(async () => {
      const result = await dependencies.handler.retry();
      if (result.status !== "completed") throw new Error(result.message);
      dependencies.writeOut(`${result.message}\n`);
    });
}
