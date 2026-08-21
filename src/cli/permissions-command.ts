import { Argument, type Command } from "commander";

import {
  approvalModes,
  type ApprovalMode,
  type PermissionConfig,
} from "../core/contracts.js";

interface PermissionCommandDependencies {
  readonly config: PermissionConfig;
  readonly writeOut: (text: string) => unknown;
}

export function addPermissionsCommand(
  program: Command,
  dependencies: PermissionCommandDependencies,
): void {
  program
    .command("permissions")
    .description("Set the checkout-local approval mode")
    .addArgument(
      new Argument("<mode>", "approval mode").choices([...approvalModes]),
    )
    .action(async (mode: ApprovalMode) => {
      await dependencies.config.write(mode);
      dependencies.writeOut(`Permission mode: ${mode}.\n`);
    });
}
