import type { Command } from "commander";

import type { RecoveryOperationHandler } from "../core/recovery-operations.js";

interface DiscardCommandDependencies {
  readonly handler: RecoveryOperationHandler;
  readonly writeOut: (text: string) => unknown;
}

export function addDiscardCommand(
  program: Command,
  dependencies: DiscardCommandDependencies,
): void {
  program
    .command("discard")
    .description("End paused or failed execution and retain artifacts")
    .option("--force", "confirm ending execution without an interactive prompt")
    .action(async (options: { force?: boolean }) => {
      if (options.force !== true) {
        throw new Error("Discard requires --force confirmation");
      }
      await dependencies.handler.discard();
      dependencies.writeOut("Discarded the active Striker run.\n");
    });
}
