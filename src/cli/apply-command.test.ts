import { expect, it } from "vitest";
import { runCli, type CliDependencies } from "./program.js";

it("applies an explicit run identity and reports refusals on stderr with failure status", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const dependencies: CliDependencies = {
    cwd: "/repo",
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planValidator: { validate: () => Promise.resolve({ taskCount: 1 }) },
    skillInstaller: {
      supportedHarnesses: [],
      install: () => Promise.resolve({ changed: false }),
    },
    applyHandler: {
      apply: (runId) => {
        if (runId !== "complete") throw new Error("Feature incomplete");
        return Promise.resolve({
          runId,
          sourceRoot: "/repo",
          sourceBranch: "main",
          sourceHead: "a".repeat(40),
          resultBranch: "codex/striker-complete",
          head: "b".repeat(40),
        });
      },
    },
  };
  expect(await runCli(["apply", "complete"], dependencies)).toBe(0);
  expect(out.join("")).toContain("Applied complete to main");
  expect(await runCli(["apply", "partial"], dependencies)).toBe(1);
  expect(err.join("")).toContain("Feature incomplete");
  expect(await runCli(["apply"], dependencies)).not.toBe(0);
});
