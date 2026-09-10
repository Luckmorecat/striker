import type { Command } from "commander";
import type { SubscriptionAuthentication } from "../core/subscription.js";

export function addAuthCommand(
  program: Command,
  handler: SubscriptionAuthentication,
  write: (text: string) => unknown,
): void {
  const auth = program
    .command("auth")
    .description("Prepare host-only subscription authentication");
  auth
    .command("prepare")
    .requiredOption(
      "--broker <path>",
      "installed pinned CLIProxyAPI executable",
    )
    .option(
      "--auth-directory <path>",
      "existing broker-owned auth directory (never a Codex auth file)",
    )
    .action(async (options: { broker: string; authDirectory?: string }) => {
      await handler.prepare(options.broker, options.authDirectory);
      write(
        "Broker prepared. Run striker auth login if subscription authentication is not ready.\n",
      );
    });
  auth
    .command("login")
    .description("Log in once; the host broker owns refresh credentials")
    .action(async () => {
      await handler.login();
      write("Subscription login completed.\n");
    });
  auth.command("status").action(async () => {
    const result = await handler.status();
    write(
      result.ready
        ? "Broker subscription login is present.\n"
        : "Subscription login required: run striker auth login.\n",
    );
  });
}
