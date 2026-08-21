import type { Command } from "commander";

import type { PlanValidator } from "../core/contracts.js";

export interface PlanCommandDependencies {
  readonly validator: PlanValidator;
  readonly writeOut: (text: string) => void;
}

export function addPlanCommand(
  program: Command,
  dependencies: PlanCommandDependencies,
): void {
  const plan = program.command("plan").description("Work with Striker plans");
  plan
    .command("validate")
    .description("Validate a versioned Striker plan")
    .argument("<source>", "plan directory")
    .action(async (source: string) => {
      const result = await dependencies.validator.validate(source);
      const noun = result.taskCount === 1 ? "task" : "tasks";
      dependencies.writeOut(
        `Valid Striker plan: ${String(result.taskCount)} ${noun}\n`,
      );
    });
}
