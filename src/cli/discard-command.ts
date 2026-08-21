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
    .description("Delete paused or failed Striker recovery state")
    .option("--force", "confirm deletion without an interactive prompt")
    .action(async (options: { force?: boolean }) => {
      if (options.force !== true) {
        throw new Error("Discard requires --force confirmation");
      }
      await dependencies.handler.discard();
      dependencies.writeOut("Discarded the active Striker run.\n");
    });
}
