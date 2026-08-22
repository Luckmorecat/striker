import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { RunOperations } from "../core/run-operations.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { runCli } from "./program.js";

const execFileAsync = promisify(execFile);

function fixture() {
  let discarded = false;
  let stdout = "";
  let stderr = "";
  return {
    dependencies: {
      cwd: "/repo",
      operationHandler: {
        discard: () => {
          discarded = true;
          return Promise.resolve();
        },
        retry: () => {
          throw new Error("Unexpected retry");
        },
        status: () => Promise.resolve(null),
      },
      permissionConfig: {
        read: () => Promise.resolve("attended" as const),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text: string) => (stderr += text) },
      stdout: { write: (text: string) => (stdout += text) },
    },
    discarded: () => discarded,
    output: () => ({ stderr, stdout }),
  };
}

describe("striker discard", () => {
  it("requires explicit noninteractive confirmation", async () => {
    const test = fixture();

    await expect(runCli(["discard"], test.dependencies)).resolves.toBe(1);
    expect(test.discarded()).toBe(false);
    expect(test.output().stderr).toContain("--force");
  });

  it("deletes recovery state after --force", async () => {
    const test = fixture();

    await expect(
      runCli(["discard", "--force"], test.dependencies),
    ).resolves.toBe(0);
    expect(test.discarded()).toBe(true);
    expect(test.output()).toEqual({
      stderr: "",
      stdout: "Discarded the active Striker run.\n",
    });
  });

  it("records discard and retains Git-private plan history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-cli-discard-"));
    await execFileAsync("git", ["-C", root, "init"]);
    const journal = new FileRunJournal(
      await new GitCliRepository().resolvePrivatePath(root, "striker"),
    );
    const request = {
      completedTasks: [],
      planId: "plan-1",
      runId: "run-1",
      skills: [],
      taskSource: { location: "/repo/plan", type: "striker-plan" },
    } as const;
    await journal.append({
      planId: request.planId,
      request,
      runId: request.runId,
      type: "run_started",
    });
    await journal.append({
      current: null,
      runId: "run-1",
      task: { id: "tasks/01.md", revision: "removed" },
      type: "run_source_changed",
    });
    const operations = new RunOperations(journal);
    const test = fixture();
    const dependencies = {
      ...test.dependencies,
      operationHandler: {
        discard: () => operations.discard(),
        retry: test.dependencies.operationHandler.retry,
        status: () => operations.status(),
      },
    };

    await expect(runCli(["discard", "--force"], dependencies)).resolves.toBe(0);
    await expect(journal.loadActive()).resolves.toBeNull();
    await expect(journal.load("plan-1")).resolves.toMatchObject({
      lastEvent: { runId: "run-1", type: "run_discarded" },
      snapshot: { status: "discarded" },
    });
  });
});
