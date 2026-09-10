import { spawnSync } from "node:child_process";

const root = new globalThis.URL(".", import.meta.url);
const prerequisite = spawnSync("docker", ["info"], {
  cwd: root,
  encoding: "utf8",
});
if (prerequisite.status !== 0) {
  globalThis.console.error(
    `Docker acceptance requires an installed, running, accessible local Docker daemon. Start Docker and grant this user access.\n${prerequisite.error?.message ?? prerequisite.stderr}`,
  );
  globalThis.process.exit(1);
}
for (const args of [
  ["exec", "tsc", "--project", "tests/tsconfig.json"],
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.docker.config.ts",
    ...globalThis.process.argv.slice(2),
  ],
]) {
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) globalThis.process.exit(result.status ?? 1);
}
