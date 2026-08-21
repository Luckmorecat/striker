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
    .description("Ask the agent to repair the active paused run")
    .action(async () => {
      const result = await dependencies.handler.resume();
      if (result.status !== "completed") throw new Error(result.message);
      dependencies.writeOut(`${result.message}\n`);
    });
}
