import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { FakeAgentRunner, runPassingReview } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  ImplementationTask,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const execFileAsync = promisify(execFile);

async function repository(prefix: string): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/${prefix}`);
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

function taskFor(root: string): ImplementationTask {
  return {
    execution: {
      affectedPaths: ["task.txt"],
      cwd: root,
      verifyCommand: "pnpm check",
      workflowInstructions: "Implement the task.",
    },
    identity: { id: "tasks/01.md", revision: "revision-1" },
    instructions: "Finish the task.",
    title: "Finish the task",
  };
}

function completionRunner(
  root: string,
  id: string,
): AgentRunner & {
  readonly requests: readonly unknown[];
  readonly resumeRequests: readonly unknown[];
} {
  const requests: unknown[] = [];
  const resumeRequests: unknown[] = [];
  return {
    preflight: () => Promise.resolve(),
    requests,
    resumeRequests,
    resumeSession: (session, instructions) => {
      resumeRequests.push({ instructions, session });
      throw new Error("Unexpected resume");
    },
    runReviewInNewSession: runPassingReview,
    runInNewSession: async (request, sessionStarted) => {
      requests.push(request);
      const session = { id };
      await sessionStarted?.(session);
      await writeFile(`${root}/task.txt`, "complete\n");
      await execFileAsync("git", ["-C", root, "add", "task.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-qm", "complete"]);
      return { output: "done", session, status: "returned" };
    },
  };
}

const verifier = {
  verify: ({ command }: { readonly command: string }) =>
    Promise.resolve({ command, exitCode: 0, output: "ok" }),
};

class RestartSource implements TaskSource {
  constructor(private readonly task: ImplementationTask) {}

  completionEvidence(): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: { summary: "task complete" },
      status: "completed",
    });
  }

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    return Promise.resolve(completed.length === 0 ? this.task : null);
  }

  reconcileCompleted(): Promise<null> {
    return Promise.resolve(null);
  }
}

describe("Dispatcher initialization restart", () => {
  it("continues a run interrupted immediately after its start event", async () => {
    const root = await repository("striker-restart-start-");
    const task = taskFor(root);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource(task)),
      type: "memory",
    });
    const request = {
      completedTasks: [],
      planId: "plan-start-recovery",
      runId: "run-start-recovery",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    await journal.append({
      planId: request.planId,
      request,
      runId: request.runId,
      type: "run_started",
    });
    const runner = completionRunner(root, "runtime-after-restart");

    await expect(
      new Dispatcher({ adapters, git, journal, runner, verifier }).resume(),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher pre-attempt restart", () => {
  it("retries attempt one after interruption before attempt start", async () => {
    const root = await repository("striker-restart-selection-");
    const task = taskFor(root);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource(task)),
      type: "memory",
    });
    const request = {
      completedTasks: [],
      planId: "plan-selection-recovery",
      runId: "run-selection-recovery",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    await journal.append({
      planId: request.planId,
      request,
      runId: request.runId,
      type: "run_started",
    });
    await journal.append({ runId: request.runId, task, type: "task_selected" });
    await journal.append({
      before: await git.inspect(root),
      runId: request.runId,
      task: task.identity,
      type: "task_baseline_recorded",
    });
    const dispatcher = new Dispatcher({
      adapters,
      git,
      journal,
      runner: completionRunner(root, "runtime-after-selection"),
      verifier,
    });

    await expect(dispatcher.resume()).resolves.toMatchObject({
      reason: "session_resume_failed",
      status: "needs_attention",
    });
    await expect(dispatcher.retry()).resolves.toMatchObject({
      status: "completed",
    });
    const events = await readFile(
      `${stateRoot}/plans/${request.planId}/events.ndjson`,
      "utf8",
    );
    const journalEvents = events
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { event: unknown }).event);
    const recovery = await journal.load(request.planId);
    expect(journalEvents).toContainEqual(
      expect.objectContaining({ attempt: 0, type: "run_retried" }),
    );
    expect(journalEvents).toContainEqual(
      expect.objectContaining({ attempt: 1, type: "task_attempt_started" }),
    );
    expect(recovery?.lastEvent).toMatchObject({ type: "run_completed" });
    expect(recovery?.completedTasks).toEqual([task.identity]);
  });
});

describe("Dispatcher interrupted initialization", () => {
  it("retries initialization attention with a new dispatcher instance", async () => {
    const root = await repository("striker-restart-initialization-");
    const task = taskFor(root);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource(task)),
      type: "memory",
    });
    const request = {
      completedTasks: [],
      planId: "run-initialization-restart",
      runId: "run-initialization-restart",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    const firstJournal = new FileRunJournal(stateRoot);
    await expect(
      new Dispatcher({
        adapters,
        git,
        journal: firstJournal,
        runner: {
          preflight: () => Promise.resolve(),
          resumeSession: () => {
            throw new Error("Unexpected resume");
          },
          runInNewSession: () =>
            Promise.reject(new Error("provider session setup failed")),
        },
      }).dispatchOne(request),
    ).resolves.toMatchObject({
      reason: "run_initialization_interrupted",
      session: null,
      status: "needs_attention",
    });

    const retryRunner = completionRunner(root, "runtime-second");
    const retryJournal = new FileRunJournal(stateRoot);
    await expect(
      new Dispatcher({
        adapters,
        git,
        journal: retryJournal,
        runner: retryRunner,
        verifier,
      }).retry(),
    ).resolves.toMatchObject({ status: "completed" });

    expect(retryRunner.requests).toHaveLength(1);
    expect(retryRunner.resumeRequests).toHaveLength(0);
    await expect(retryJournal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher failed-run restart", () => {
  it("retries failed Git-private state with a fresh runner instance", async () => {
    const root = await repository("striker-restart-git-");
    const task = taskFor(root);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource(task)),
      type: "memory",
    });
    const request = {
      completedTasks: [],
      planId: "run-restart",
      runId: "run-restart",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;
    const firstRunner = new FakeAgentRunner({
      error: "provider disconnected",
      session: { id: "runtime-first", resumeId: "provider-first" },
      status: "failed",
    });
    await expect(
      new Dispatcher({
        adapters,
        git,
        journal,
        runner: firstRunner,
      }).dispatchOne(request),
    ).resolves.toMatchObject({ status: "failed" });

    const retryRunner = completionRunner(root, "runtime-second");
    await expect(
      new Dispatcher({
        adapters,
        git,
        journal,
        runner: retryRunner,
        verifier,
      }).retry(),
    ).resolves.toMatchObject({ status: "completed" });

    expect(firstRunner.requests).toHaveLength(1);
    expect(retryRunner.requests).toHaveLength(1);
    expect(retryRunner.resumeRequests).toHaveLength(0);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});
