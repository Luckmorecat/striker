import type {
  CommandInteraction,
  InteractionOptions,
} from "./interactive-controller.js";
import type { Command } from "commander";

import type { RecoveryOperationHandler } from "../core/recovery-operations.js";

interface RetryCommandDependencies {
  readonly controller: CommandInteraction;
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
    .option(
      "--no-interactive",
      "disable the dashboard, attention and permission prompts",
    )
    .action(async (options: InteractionOptions) => {
      dependencies.controller.prepare(options);
      const result = await dependencies.handler.retry();
      await dependencies.controller.finish(result);
    });
}
