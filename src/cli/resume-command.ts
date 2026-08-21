import type { Command } from "commander";

import type { RecoveryCommandHandler } from "../core/contracts.js";

interface ResumeCommandDependencies {
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
    .action(async () => {
      const result = await dependencies.handler.resume();
      if (result.status !== "completed") throw new Error(result.message);
      dependencies.writeOut(`${result.message}\n`);
    });
}
