import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { RetainedFeatureEnvironment } from "../../core/environment-preparation.js";
import { dockerCommand } from "./docker-command.js";

async function sourceGit(root: string, args: readonly string[]) {
  return (
    await promisify(execFile)(
      "git",
      [
        "--no-optional-locks",
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      },
    )
  ).stdout.trim();
}
export async function exportSourceCheckout(source: string, inputs: string) {
  if (
    await sourceGit(source, ["status", "--porcelain", "--untracked-files=all"])
  )
    throw new Error(
      "Docker execution requires a clean committed source checkout",
    );
  const head = await sourceGit(source, ["rev-parse", "--verify", "HEAD"]);
  const branch = await sourceGit(source, ["symbolic-ref", "--short", "HEAD"]);
  await sourceGit(source, [
    "bundle",
    "create",
    path.join(inputs, "source.bundle"),
    "HEAD",
  ]);
  if (head !== (await sourceGit(source, ["rev-parse", "HEAD"])))
    throw new Error("Source changed while preparing Docker execution");
  return { head, branch };
}
export async function initializeCheckout(
  environment: RetainedFeatureEnvironment,
): Promise<void> {
  const exec = (args: string[]) =>
    dockerCommand([
      "exec",
      environment.environmentId,
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ]);
  await exec([
    "clone",
    "--no-local",
    "--no-hardlinks",
    "/opt/striker/run/source.bundle",
    "/workspace",
  ]);
  await exec(["-C", "/workspace", "remote", "remove", "origin"]);
  await exec(["-C", "/workspace", "config", "user.name", "Striker"]);
  await exec(["-C", "/workspace", "config", "user.email", "striker@localhost"]);
}
