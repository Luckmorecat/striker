import type {
  CommandInteraction,
  InteractionOptions,
} from "./interactive-controller.js";
import type { Command } from "commander";

import type { RecoveryCommandHandler } from "../core/contracts.js";

import type {
  RecoveryInspection,
  RecoveryInspector,
} from "../core/recovery-operations.js";
import type { AnswerInput } from "./terminal/answer-composer.js";

import { AnswerCancelled } from "./input-cancelled.js";
export { AnswerCancelled } from "./input-cancelled.js";
export interface AnswerReader {
  read(
    file: string | undefined,
    context?: RecoveryInspection,
  ): Promise<string | AnswerInput>;
}

interface AnswerCommandDependencies {
  readonly inspector?: RecoveryInspector;
  readonly controller: CommandInteraction;
  readonly handler: RecoveryCommandHandler;
  readonly reader: AnswerReader;
  readonly writeOut: (text: string) => unknown;
}

export function addAnswerCommand(
  program: Command,
  dependencies: AnswerCommandDependencies,
): void {
  program
    .command("answer")
    .description("Answer the agent in the active paused run")
    .option("--file <path>", "read the answer from a file instead of stdin")
    .option(
      "--no-interactive",
      "disable the dashboard, attention and permission prompts",
    )
    .action(async (options: InteractionOptions) => {
      dependencies.controller.prepare(options);
      const context = await dependencies.inspector?.inspectRecovery();
      if (context === null) throw new Error("No Striker run is active");
      if (context !== undefined && context.availability.answer !== null) {
        throw new Error(
          `${context.availability.answer}. Use striker status to inspect recovery options.`,
        );
      }
      const input = await dependencies.reader.read(options.file, context);
      if (typeof input !== "string" && input.status === "cancelled")
        throw new AnswerCancelled(input.exitCode);
      const answer = typeof input === "string" ? input : input.text;
      const result = await dependencies.handler.answer(answer);
      await dependencies.controller.finish(result, typeof input !== "string");
    });
}
