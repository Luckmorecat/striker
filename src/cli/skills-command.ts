import { Option, type Command } from "commander";

import type { CliDependencies } from "./program.js";

interface InstallOptions {
  readonly harness: string;
}

export function addSkillsCommand(
  program: Command,
  dependencies: CliDependencies,
): void {
  const skills = program
    .command("skills")
    .description("Install Striker skills");
  skills
    .command("install")
    .description("Install public Striker skills for one harness")
    .addOption(
      new Option("--harness <harness>", "agent harness")
        .choices([...dependencies.skillInstaller.supportedHarnesses])
        .makeOptionMandatory(),
    )
    .action(async (options: InstallOptions) => {
      const result = await dependencies.skillInstaller.install({
        harness: options.harness,
        projectRoot: dependencies.cwd,
      });
      dependencies.stdout.write(
        result.changed
          ? "Installed public Striker skills.\n"
          : "Public Striker skills are already installed.\n",
      );
    });
}
