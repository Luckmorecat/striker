import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const baseline = JSON.parse(globalThis.process.argv[2]);
for (const [name, version] of Object.entries(baseline.packages)) {
  const installed = JSON.parse(
    readFileSync(`/usr/local/lib/node_modules/${name}/package.json`, "utf8"),
  );
  if (installed.version !== version)
    throw new Error(`Expected ${name}@${version}; found ${installed.version}`);
}
for (const command of baseline.commands) {
  execFileSync("sh", ["-c", 'command -v "$1"', "probe", command]);
}
execFileSync("node", ["--version"]);
execFileSync("pnpm", ["--version"]);
execFileSync("git", ["--version"]);
