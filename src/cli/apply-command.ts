import type { Command } from "commander";
import type { ApplyFeatureHandler } from "../core/apply-feature.js";

export function addApplyCommand(
  program: Command,
  handler: ApplyFeatureHandler,
  writeOut: (text: string) => unknown,
): void {
  program
    .command("apply <run-id>")
    .description(
      "Advance the original clean branch to a completed feature's certified result",
    )
    .action(async (runId: string) => {
      const result = await handler.apply(runId);
      writeOut(
        `Applied ${runId} to ${result.sourceBranch} at ${result.head}. Result branch: ${result.resultBranch}.\n`,
      );
    });
}
