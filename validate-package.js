import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new globalThis.URL(".", import.meta.url));
const requiredFiles = [
  "dist/cli.js",
  "dist/index.d.ts",
  "dist/index.js",
  "plan.schema.json",
  "README.md",
  "schema.json",
  "skills/striker/SKILL.md",
  "skills/striker/agents/openai.yaml",
  "skills/striker-plan/SKILL.md",
  "skills/striker-plan/agents/openai.yaml",
  "skills/striker-implementor/SKILL.md",
  "skills/striker-implementor/references/review.md",
  "skills/striker-implementor/references/tdd.md",
];

await Promise.all(requiredFiles.map((file) => access(path.join(root, file))));

const publicApi = await import(path.join(root, "dist/index.js"));
for (const exportName of [
  "AdapterRegistry",
  "Dispatcher",
  "planManifestSchema",
  "projectConfigSchema",
]) {
  if (!(exportName in publicApi)) {
    throw new Error(`missing public export: ${exportName}`);
  }
}

const help = spawnSync(
  globalThis.process.execPath,
  [path.join(root, "dist/cli.js"), "--help"],
  { cwd: root, encoding: "utf8" },
);
if (help.status !== 0 || !help.stdout.includes("Usage: striker")) {
  throw new Error(`packed CLI help failed: ${help.stderr || help.stdout}`);
}
