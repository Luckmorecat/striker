import type { Command } from "commander";
import type { EnvironmentPreparer } from "../core/environment-preparation.js";

export function addEnvironmentCommand(
  program: Command,
  handler: EnvironmentPreparer,
  write: (text: string) => unknown,
): void {
  program
    .command("environment")
    .description("Prepare isolated execution prerequisites")
    .command("prepare")
    .description(
      "Build/cache the bundled image or validate the configured local image",
    )
    .option(
      "--approve-image",
      "locally approve the configured image's immutable ID",
    )
    .action(async (options: { approveImage?: boolean }) => {
      const result = await handler.prepare(options.approveImage === true);
      write(
        `Prepared image ${result.imageId}\nFeature execution remains local.\n`,
      );
    });
}
