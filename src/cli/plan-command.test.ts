import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";
import { runCli } from "./program.js";

async function validPlan(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cli-plan-"));
  await mkdir(path.join(root, "tasks"));
  await Promise.all([
    writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        assumptions: {},
        defaults: {},
        taskSource: "striker-plan",
        tasks: ["tasks/01-build.md"],
        version: 2,
      }),
    ),
    writeFile(path.join(root, "spine.md"), "# Spine\n"),
    writeFile(path.join(root, "map.md"), "# Map\n"),
    writeFile(
      path.join(root, "tasks/01-build.md"),
      "# Build it\n\n## Build\n\nBuild it.\n\n## Paths\n\n- src\n\n## Test contract\n\n- CLI\n\n## Verify\n\n```sh\npnpm test\n```\n",
    ),
  ]);
  return root;
}

async function validatePlan(root: string): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["plan", "validate", root], {
    cwd: root,
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planValidator: {
      validate: async (source) => {
        const plan = await parseStrikerPlan(path.resolve(root, source));
        return { taskCount: plan.tasks.length };
      },
    },
    stderr: { write: (text) => (stderr += text) },
    skillInstaller: {
      install: () => Promise.resolve({ changed: false }),
      supportedHarnesses: [],
    },
    stdout: { write: (text) => (stdout += text) },
  });
  return { exitCode, stderr, stdout };
}

describe("striker plan validate", () => {
  it("validates a complete plan through the CLI", async () => {
    const root = await validPlan();
    const result = await validatePlan(root);

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Valid Striker plan: 1 task\n",
    });
  });

  it("rejects a version 1 plan through the CLI", async () => {
    const root = await validPlan();
    const manifestPath = path.join(root, "plan.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 1 }));

    const result = await validatePlan(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid input: expected 2");
  });
});
