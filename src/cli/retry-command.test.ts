import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { AdapterRegistry } from "../core/adapter-registry.js";
import type {
  AgentRunner,
  GitState,
  ImplementationTask,
} from "../core/contracts.js";
import { Dispatcher } from "../core/dispatcher.js";
import { RunOperations } from "../core/run-operations.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { runPassingStandardsReview } from "../testing/fakes.js";
import { InMemoryTaskSourceAdapter } from "../testing/fakes.js";
import { runCli } from "./program.js";

const execFileAsync = promisify(execFile);
const fileTask = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build.",
  title: "Build",
};
const fileRequest = {
  completedTasks: [],
  planId: "run-file",
  runId: "run-file",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
} as const;

async function seedFailedJournal(
  journal: FileRunJournal,
  task: ImplementationTask,
  before: GitState,
): Promise<void> {
  const session = { id: "runtime-old", resumeId: "provider-old" };
  await journal.append({
    planId: fileRequest.planId,
    request: fileRequest,
    runId: fileRequest.runId,
    type: "run_started",
  });
  await journal.append({
    runId: fileRequest.runId,
    task,
    type: "task_selected",
  });
  await journal.append({
    before,
    runId: fileRequest.runId,
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: fileRequest.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    runId: fileRequest.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  await journal.append({
    error: "provider disconnected",
    runId: fileRequest.runId,
    session,
    task: task.identity,
    type: "run_failed",
  });
}

async function gitFixture(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/striker-cli-retry-`);
  await execFileAsync("git", ["-C", root, "init", "-q"]);
  await execFileAsync("git", [
    "-C",
    root,
    "config",
    "user.name",
    "Striker Test",
  ]);
  await execFileAsync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "striker@example.test",
  ]);
  await writeFile(`${root}/task.txt`, "initial\n");
  await execFileAsync("git", ["-C", root, "add", "task.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-qm", "initial"]);
  return root;
}

function retryRunner(
  root: string,
): AgentRunner & { readonly resumeRequests: readonly unknown[] } {
  const resumeRequests: unknown[] = [];
  return {
    preflight: () => Promise.resolve(),
    resumeRequests,
    resumeSession: (session, instructions) => {
      resumeRequests.push({ instructions, session });
      throw new Error("Retry must start a fresh session");
    },
    runReviewInNewSession: runPassingStandardsReview,
    runInNewSession: async (_request, sessionStarted) => {
      const session = { id: "runtime-new", resumeId: "provider-new" };
      await sessionStarted?.(session);
      await writeFile(`${root}/task.txt`, "complete\n");
      await execFileAsync("git", ["-C", root, "add", "task.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-qm", "complete"]);
      return { output: "done", session, status: "returned" };
    },
  };
}

async function fileRetryFixture() {
  const root = await gitFixture();
  const git = new GitCliRepository();
  const task: ImplementationTask = {
    ...fileTask,
    execution: {
      affectedPaths: ["task.txt"],
      cwd: root,
      verifyCommand: "pnpm check",
      workflowInstructions: "Implement the task.",
    },
  };
  const journal = new FileRunJournal(
    await git.resolvePrivatePath(root, "striker"),
  );
  await seedFailedJournal(journal, task, await git.inspect(root));
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      [task.identity.id]: { summary: "task complete" },
    }),
  );
  const runner = retryRunner(root);
  const dispatcher = new Dispatcher({
    adapters,
    git,
    journal,
    runner,
    verifier: {
      verify: ({ command }) =>
        Promise.resolve({ command, exitCode: 0, output: "ok" }),
    },
  });
  const operations = new RunOperations(journal);
  let stdout = "";
  return {
    dependencies: {
      cwd: root,
      operationHandler: {
        discard: () => operations.discard(),
        retry: async () => {
          const result = await dispatcher.retry();
          if (result.status !== "completed") {
            return {
              message: "Retry did not complete.",
              status: "failed" as const,
            };
          }
          return {
            message: `Completed ${result.task.identity.id}.`,
            status: "completed" as const,
          };
        },
        status: () => operations.status(),
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
      stderr: { write: () => undefined },
      stdout: { write: (text: string) => (stdout += text) },
    },
    journal,
    output: () => stdout,
    runner,
  };
}

describe("striker retry", () => {
  it("starts a fresh attempt through the recovery operation handler", async () => {
    let retried = false;
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(["retry"], {
      cwd: "/repo",
      operationHandler: {
        discard: () => Promise.resolve(),
        retry: () => {
          retried = true;
          return Promise.resolve({
            message: "Completed tasks/01.md.",
            status: "completed",
          });
        },
        status: () => Promise.resolve(null),
      },
      permissionConfig: {
        read: () => Promise.resolve("attended"),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text) => (stderr += text) },
      stdout: { write: (text) => (stdout += text) },
    });

    expect(exitCode).toBe(0);
    expect(retried).toBe(true);
    expect(stdout).toBe("Completed tasks/01.md.\n");
    expect(stderr).toBe("");
  });
});

describe("striker retry with file recovery", () => {
  it("retries a temporary Git-private journal through the CLI", async () => {
    const test = await fileRetryFixture();

    await expect(runCli(["retry"], test.dependencies)).resolves.toBe(0);
    expect(test.output()).toBe("Completed tasks/01.md.\n");
    expect(test.runner.resumeRequests).toHaveLength(0);
    await expect(test.journal.loadActive()).resolves.toBeNull();
  });
});
