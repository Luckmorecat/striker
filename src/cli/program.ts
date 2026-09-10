import {
  InteractiveController,
  type RecoveryInteraction,
} from "./interactive-controller.js";
import { Command, CommanderError } from "commander";

import type {
  PlanValidator,
  PlanQueryHandler,
  PermissionConfig,
  PublicSkillInstaller,
  RecoveryCommandHandler,
  RunCommandHandler,
} from "../core/contracts.js";
import type {
  RecoveryInspector,
  RecoveryOperationHandler,
} from "../core/recovery-operations.js";
import {
  addAnswerCommand,
  AnswerCancelled,
  type AnswerReader,
} from "./answer-command.js";
import type { EnvironmentPreparer } from "../core/environment-preparation.js";
import type { SubscriptionAuthentication } from "../core/subscription.js";
import { addAuthCommand } from "./auth-command.js";
import { addEnvironmentCommand } from "./environment-command.js";
import { addDiscardCommand } from "./discard-command.js";
import { addPlanCommand } from "./plan-command.js";
import { addPermissionsCommand } from "./permissions-command.js";
import { addRunCommand } from "./run-command.js";
import { addResumeCommand } from "./resume-command.js";
import { addRetryCommand } from "./retry-command.js";
import { addSkillsCommand } from "./skills-command.js";
import { addStatusCommand } from "./status-command.js";

export interface CliWriter {
  write(text: string): unknown;
}

export interface CliDependencies {
  readonly subscriptionAuthentication?: SubscriptionAuthentication;
  readonly interaction?: RecoveryInteraction;
  readonly environmentPreparer?: EnvironmentPreparer;
  readonly answerReader?: AnswerReader;
  readonly recoveryInspector?: RecoveryInspector;
  readonly cwd: string;
  readonly permissionConfig: PermissionConfig;
  readonly planQueryHandler?: PlanQueryHandler;
  readonly planValidator: PlanValidator;
  readonly runHandler?: RunCommandHandler;
  readonly recoveryHandler?: RecoveryCommandHandler;
  readonly operationHandler?: RecoveryOperationHandler;
  readonly skillInstaller: PublicSkillInstaller;
  readonly stderr: CliWriter;
  readonly stdout: CliWriter;
}

export function createProgram(dependencies: CliDependencies): Command {
  const controller = new InteractiveController(dependencies);
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
    ...(dependencies.planQueryHandler === undefined
      ? {}
      : { queryHandler: dependencies.planQueryHandler }),
    validator: dependencies.planValidator,
    writeOut: (text) => {
      dependencies.stdout.write(text);
    },
  });
  addPermissionsCommand(program, {
    config: dependencies.permissionConfig,
    writeOut: (text) => dependencies.stdout.write(text),
  });
  if (dependencies.runHandler !== undefined) {
    addRunCommand(program, {
      controller,
      handler: dependencies.runHandler,
      permissionConfig: dependencies.permissionConfig,
      writeOut: (text) => dependencies.stdout.write(text),
    });
  }
  if (
    dependencies.recoveryHandler !== undefined &&
    dependencies.answerReader !== undefined
  ) {
    addAnswerCommand(program, {
      controller,
      ...(dependencies.recoveryInspector === undefined
        ? {}
        : { inspector: dependencies.recoveryInspector }),
      handler: dependencies.recoveryHandler,
      reader: dependencies.answerReader,
      writeOut: (text) => dependencies.stdout.write(text),
    });
  }
  if (dependencies.recoveryHandler !== undefined) {
    addResumeCommand(program, {
      controller,
      handler: dependencies.recoveryHandler,
      writeOut: (text) => dependencies.stdout.write(text),
    });
  }
  if (dependencies.operationHandler !== undefined) {
    addRetryCommand(program, {
      controller,
      handler: dependencies.operationHandler,
      writeOut: (text) => dependencies.stdout.write(text),
    });
    addDiscardCommand(program, {
      handler: dependencies.operationHandler,
      writeOut: (text) => dependencies.stdout.write(text),
    });
    addStatusCommand(program, {
      handler: dependencies.operationHandler,
      writeOut: (text) => dependencies.stdout.write(text),
    });
  }
  addPreparationCommands(program, dependencies);
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
    if (error instanceof AnswerCancelled) {
      dependencies.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommanderError) return error.exitCode;
    const message = error instanceof Error ? error.message : String(error);
    dependencies.stderr.write(`error: ${message}\n`);
    return 1;
  }
}

function addPreparationCommands(
  program: Command,
  dependencies: CliDependencies,
): void {
  if (dependencies.environmentPreparer)
    addEnvironmentCommand(program, dependencies.environmentPreparer, (text) =>
      dependencies.stdout.write(text),
    );
  if (dependencies.subscriptionAuthentication)
    addAuthCommand(program, dependencies.subscriptionAuthentication, (text) =>
      dependencies.stdout.write(text),
    );
}
