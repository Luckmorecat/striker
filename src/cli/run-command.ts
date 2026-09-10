import type {
  CommandInteraction,
  InteractionOptions,
} from "./interactive-controller.js";
import type { Command } from "commander";

import type { PermissionConfig, RunCommandHandler } from "../core/contracts.js";

interface RunCommandDependencies {
  readonly controller: CommandInteraction;
  readonly handler: RunCommandHandler;
  readonly permissionConfig: PermissionConfig;
  readonly writeOut: (text: string) => unknown;
}

export function addRunCommand(
  program: Command,
  dependencies: RunCommandDependencies,
): void {
  program
    .command("run")
    .description("Run every remaining task from a Striker plan")
    .argument("<source>", "Striker plan directory")
    .option("--allow-dirty", "preserve non-overlapping existing changes")
    .option("--no-interactive", "disable attention and permission prompts")
    .action(
      async (
        source: string,
        options: InteractionOptions & { allowDirty?: boolean },
      ) => {
        dependencies.controller.prepare(options);
        const approvalMode = await dependencies.permissionConfig.read();
        dependencies.writeOut(`Permission mode: ${approvalMode}.\n`);
        const result = await dependencies.handler.run({
          allowDirty: options.allowDirty ?? false,
          approvalMode,
          source,
        });
        await dependencies.controller.finish(result);
      },
    );
}
