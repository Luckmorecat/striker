import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new globalThis.URL(".", import.meta.url));
const requiredFiles = [
  "LICENSE",
  "dist/cli.js",
  "dist/index.d.ts",
  "dist/index.js",
  "plan.schema.json",
  "README.md",
  "schema.json",
  "runtime/Dockerfile",
  "runtime/baseline.json",
  "runtime/.dockerignore",
  "runtime/install.mjs",
  "runtime/probe.mjs",
  "runtime/gateway-bridge.mjs",
  "runtime/harness-config.mjs",
  "runtime/pi-search.mjs",
  "runtime/search-mcp.mjs",
  "skills/striker/SKILL.md",
  "skills/striker/CLI.md",
  "skills/striker/agents/openai.yaml",
  "skills/striker-shape/SKILL.md",
  "skills/striker-shape/agents/openai.yaml",
  "skills/striker-spec/SKILL.md",
  "skills/striker-spec/agents/openai.yaml",
  "skills/striker-plan/SKILL.md",
  "skills/striker-plan/BOOTSTRAP.md",
  "skills/striker-plan/PLAN-FORMAT.md",
  "skills/striker-plan/agents/openai.yaml",
  "skills/striker-preparation/BRIEF-FORMAT.md",
  "skills/striker-preparation/SKILL.md",
  "skills/striker-preparation/SPEC-FORMAT.md",
  "skills/striker-preparation/agents/openai.yaml",
  "skills/striker-implementor/SKILL.md",
  "skills/striker-implementor/references/tdd.md",
];

await Promise.all(requiredFiles.map((file) => access(path.join(root, file))));
await access(path.join(root, "PUBLISHING.md"));

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const releaseVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (
  packageJson.name !== "@useless_mob/striker" ||
  typeof packageJson.version !== "string" ||
  packageJson.version === "0.0.0" ||
  !releaseVersion.test(packageJson.version) ||
  packageJson.license !== "MIT" ||
  packageJson.private === true ||
  packageJson.publishConfig?.access !== "public" ||
  packageJson.publishConfig?.registry !== "https://registry.npmjs.org/"
) {
  throw new Error("package release metadata is invalid");
}

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
