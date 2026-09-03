import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { RecoveryOperationHandler } from "../core/recovery-operations.js";
import { RunOperations } from "../core/run-operations.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { runCli } from "./program.js";

const execFileAsync = promisify(execFile);

function cliDependencies(status: RecoveryOperationHandler["status"]) {
  let stdout = "";
  let stderr = "";
  return {
    dependencies: {
      cwd: "/repo",
      operationHandler: {
        discard: () => Promise.resolve(),
        retry: () => {
          throw new Error("Unexpected retry");
        },
        status,
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
    output: () => ({ stderr, stdout }),
  };
}

async function pausedFileJournal(): Promise<FileRunJournal> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cli-status-"));
  await execFileAsync("git", ["-C", root, "init"]);
  const journal = new FileRunJournal(
    await new GitCliRepository().resolvePrivatePath(root, "striker"),
  );
  const task = {
    identity: { id: "tasks/04.md", revision: "revision-4" },
    instructions: "Build.",
    title: "Build",
  };
  const session = { id: "runtime-file", resumeId: "provider-file" };
  const request = {
    completedTasks: [],
    planId: "run-file",
    runId: "run-file",
    skills: [],
    taskSource: { location: "/repo/plan", type: "striker-plan" },
  } as const;
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: "run-file", task, type: "task_selected" });
  await journal.append({
    before: null,
    runId: "run-file",
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: "run-file",
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: task.instructions, skills: [] },
    runId: "run-file",
    session,
    task: task.identity,
    type: "task_session_started",
  });
  await journal.append({
    attention: {
      detail: "Verification failed.",
      reason: "verification_failed",
    },
    runId: "run-file",
    session,
    task: task.identity,
    type: "run_needs_attention",
  });
  return journal;
}

describe("striker status", () => {
  it("reports the active attempt and last durable transition", async () => {
    const fixture = cliDependencies(() =>
      Promise.resolve({
        attempt: 2,
        attentionReason: "verification_failed",
        lastTransition: "run_needs_attention",
        runId: "run-7",
        session: { id: "runtime-session", resumeId: "provider-session" },
        status: "needs_attention",
        task: { id: "tasks/03.md", revision: "revision-3" },
      }),
    );

    const exitCode = await runCli(["status"], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.output()).toEqual({
      stderr: "",
      stdout:
        "Run: run-7\nStatus: needs_attention\nTask: tasks/03.md@revision-3\nAttempt: 2\nRuntime session: runtime-session\nProvider session: provider-session\nLast transition: run_needs_attention\nAttention: verification_failed\n",
    });
  });

  it("reports when no run is active", async () => {
    const fixture = cliDependencies(() => Promise.resolve(null));

    await expect(runCli(["status"], fixture.dependencies)).resolves.toBe(0);
    expect(fixture.output().stdout).toBe("No active Striker run.\n");
  });

  it("reads status from a temporary Git-private journal", async () => {
    const journal = await pausedFileJournal();
    const fixture = cliDependencies(() => new RunOperations(journal).status());

    await expect(runCli(["status"], fixture.dependencies)).resolves.toBe(0);
    expect(fixture.output().stdout).toContain("Attempt: 1\n");
    expect(fixture.output().stdout).toContain(
      "Last transition: run_needs_attention\n",
    );
  });
});
