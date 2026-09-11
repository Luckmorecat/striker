import type { Command } from "commander";
import type { CleanupFeatureHandler } from "../core/cleanup-feature.js";

export function addCleanupCommand(
  program: Command,
  handler: CleanupFeatureHandler,
  writeOut: (text: string) => unknown,
): void {
  program
    .command("cleanup <run-id>")
    .description(
      "Delete inactive execution workspace, including unexported work; retain result branch and journal",
    )
    .option("--force", "confirm permanent deletion of unexported work")
    .action(async (runId: string, options: { force?: boolean }) => {
      if (options.force !== true)
        throw new Error(
          "Cleanup requires --force: workspace deletion removes unexported work",
        );
      await handler.cleanup(runId);
      writeOut(
        `Cleaned up ${runId}. Host result branch and journal retained.\n`,
      );
    });
}
