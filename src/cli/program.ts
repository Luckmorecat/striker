import { Command, CommanderError } from "commander";

import type {
  PlanValidator,
  PublicSkillInstaller,
  RunCommandHandler,
} from "../core/contracts.js";
import { addPlanCommand } from "./plan-command.js";
import { addRunCommand } from "./run-command.js";
import { addSkillsCommand } from "./skills-command.js";

export interface CliWriter {
  write(text: string): unknown;
}

export interface CliDependencies {
  readonly cwd: string;
  readonly planValidator: PlanValidator;
  readonly runHandler?: RunCommandHandler;
  readonly skillInstaller: PublicSkillInstaller;
  readonly stderr: CliWriter;
  readonly stdout: CliWriter;
}

export function createProgram(dependencies: CliDependencies): Command {
  const program = new Command()
    .name("striker")
    .description("Dispatch implementation tasks from a Striker plan")
    .configureOutput({
      writeErr: (text) => {
        dependencies.stderr.write(text);
      },
      writeOut: (text) => {
        dependencies.stdout.write(text);
      },
    })
    .exitOverride();
  addPlanCommand(program, {
    validator: dependencies.planValidator,
    writeOut: (text) => {
      dependencies.stdout.write(text);
    },
  });
  if (dependencies.runHandler !== undefined) {
    addRunCommand(program, {
      handler: dependencies.runHandler,
      writeOut: (text) => dependencies.stdout.write(text),
    });
  }
  addSkillsCommand(program, dependencies);
  return program;
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const program = createProgram(dependencies);
  try {
    await program.parseAsync([...arguments_], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    const message = error instanceof Error ? error.message : String(error);
    dependencies.stderr.write(`error: ${message}\n`);
    return 1;
  }
}
