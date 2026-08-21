import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
        taskSource: "striker-plan",
        tasks: ["tasks/01-build.md"],
        version: 1,
      }),
    ),
    writeFile(path.join(root, "spine.md"), "# Spine\n"),
    writeFile(path.join(root, "map.md"), "# Map\n"),
    writeFile(path.join(root, "log.md"), "# Log\n"),
    writeFile(
      path.join(root, "tasks/01-build.md"),
      "# Build it\n\n## Build\n\nBuild it.\n\n## Paths\n\n- src\n\n## Test contract\n\n- CLI\n\n## Verify\n\n```sh\npnpm test\n```\n",
    ),
  ]);
  return root;
}

describe("striker plan validate", () => {
  it("validates a complete plan through the CLI", async () => {
    const root = await validPlan();
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["plan", "validate", root], {
      cwd: root,
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

    expect(exitCode).toBe(0);
    expect(stdout).toBe("Valid Striker plan: 1 task\n");
    expect(stderr).toBe("");
  });
});
