import { expect, it } from "vitest";
import { runCli, type CliDependencies } from "./program.js";

it("requires an explicit run and confirmation of unexported workspace deletion", async () => {
  const out: string[] = [],
    err: string[] = [],
    removed: string[] = [];
  const dependencies: CliDependencies = {
    cwd: "/repo",
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
    skillInstaller: {
      supportedHarnesses: [],
      install: () => Promise.resolve({ changed: false }),
    },
    cleanupHandler: {
      cleanup: (runId) => {
        removed.push(runId);
        return Promise.resolve();
      },
    },
  };
  expect(await runCli(["cleanup", "old-run"], dependencies)).toBe(1);
  expect(removed).toEqual([]);
  expect(err.join("")).toMatch(/--force.*unexported/);
  expect(await runCli(["cleanup", "old-run", "--force"], dependencies)).toBe(0);
  expect(removed).toEqual(["old-run"]);
  expect(out.join("")).toContain("journal retained");
  expect(await runCli(["cleanup", "--force"], dependencies)).not.toBe(0);
});
