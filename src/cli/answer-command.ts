import type { Command } from "commander";

import type { RecoveryCommandHandler } from "../core/contracts.js";

export interface AnswerReader {
  read(file: string | undefined): Promise<string>;
}

interface AnswerCommandDependencies {
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
    .action(async (options: { file?: string }) => {
      const answer = await dependencies.reader.read(options.file);
      const result = await dependencies.handler.answer(answer);
      if (result.status !== "completed") throw new Error(result.message);
      dependencies.writeOut(`${result.message}\n`);
    });
}
