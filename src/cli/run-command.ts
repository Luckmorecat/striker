import type { Command } from "commander";

import type { PermissionConfig, RunCommandHandler } from "../core/contracts.js";

interface RunCommandDependencies {
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
    .action(async (source: string, options: { allowDirty?: boolean }) => {
      const approvalMode = await dependencies.permissionConfig.read();
      dependencies.writeOut(`Permission mode: ${approvalMode}.\n`);
      const result = await dependencies.handler.run({
        allowDirty: options.allowDirty ?? false,
        approvalMode,
        source,
      });
      if (result.status !== "completed") throw new Error(result.message);
      dependencies.writeOut(`${result.message}\n`);
    });
}
