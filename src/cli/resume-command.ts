import type {
  CommandInteraction,
  InteractionOptions,
} from "./interactive-controller.js";
import type { Command } from "commander";

import type { RecoveryCommandHandler } from "../core/contracts.js";

interface ResumeCommandDependencies {
  readonly controller: CommandInteraction;
  readonly handler: RecoveryCommandHandler;
  readonly writeOut: (text: string) => unknown;
}

export function addResumeCommand(
  program: Command,
  dependencies: ResumeCommandDependencies,
): void {
  program
    .command("resume")
    .description("Resume an interrupted run or repair a paused run")
    .option(
      "--no-interactive",
      "disable the dashboard, attention and permission prompts",
    )
    .action(async (options: InteractionOptions) => {
      dependencies.controller.prepare(options);
      const result = await dependencies.handler.resume();
      await dependencies.controller.finish(result);
    });
}
