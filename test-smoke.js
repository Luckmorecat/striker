import { spawnSync } from "node:child_process";
import process from "node:process";
const args = process.argv.slice(2);
const index = args.indexOf("--harness");
const harness = index < 0 ? undefined : args[index + 1];
if (
  !["codex", "pi"].includes(harness) ||
  !process.env.STRIKER_SMOKE_BROKER_ROOT
) {
  globalThis.console.error(
    "Usage: STRIKER_SMOKE_BROKER_ROOT=<prepared host broker directory> pnpm test:smoke subscription --harness codex|pi. Prepare with striker auth prepare and complete striker auth login first.",
  );
  process.exit(1);
}
args.splice(index, 2);
for (const command of [
  ["exec", "tsc", "--project", "tests/tsconfig.json"],
  ["exec", "vitest", "run", "--config", "vitest.smoke.config.ts", ...args],
]) {
  const result = spawnSync("pnpm", command, {
    stdio: "inherit",
    env: { ...process.env, STRIKER_SMOKE_HARNESS: harness },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
