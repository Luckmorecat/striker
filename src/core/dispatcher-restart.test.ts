import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { FakeAgentRunner } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  ImplementationTask,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const execFileAsync = promisify(execFile);
const task: ImplementationTask = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Finish the task.",
  title: "Finish the task",
};

class RestartSource implements TaskSource {
  completionEvidence(): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: { summary: "task complete" },
      status: "completed",
    });
  }

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    return Promise.resolve(completed.length === 0 ? task : null);
  }

  reconcileCompleted(): Promise<null> {
    return Promise.resolve(null);
  }
}

describe("Dispatcher initialization restart", () => {
  it("continues a run interrupted immediately after its start event", async () => {
    const root = await mkdtemp(`${tmpdir()}/striker-restart-start-`);
    await execFileAsync("git", ["-C", root, "init"]);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource()),
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
    const runner = new FakeAgentRunner({
      output: "done",
      session: { id: "runtime-after-restart" },
      status: "returned",
    });

    await expect(
      new Dispatcher({ adapters, git, journal, runner }).resume(),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher pre-attempt restart", () => {
  it("retries attempt one after interruption before attempt start", async () => {
    const root = await mkdtemp(`${tmpdir()}/striker-restart-selection-`);
    await execFileAsync("git", ["-C", root, "init"]);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource()),
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
      before: null,
      runId: request.runId,
      task: task.identity,
      type: "task_baseline_recorded",
    });
    const dispatcher = new Dispatcher({
      adapters,
      git,
      journal,
      runner: new FakeAgentRunner({
        output: "done",
        session: { id: "runtime-after-selection" },
        status: "returned",
      }),
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
    const root = await mkdtemp(`${tmpdir()}/striker-restart-initialization-`);
    await execFileAsync("git", ["-C", root, "init"]);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource()),
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

    const retryRunner = new FakeAgentRunner({
      output: "done",
      session: { id: "runtime-second", resumeId: "provider-second" },
      status: "returned",
    });
    const retryJournal = new FileRunJournal(stateRoot);
    await expect(
      new Dispatcher({
        adapters,
        git,
        journal: retryJournal,
        runner: retryRunner,
      }).retry(),
    ).resolves.toMatchObject({ status: "completed" });

    expect(retryRunner.requests).toHaveLength(1);
    expect(retryRunner.resumeRequests).toHaveLength(0);
    await expect(retryJournal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher failed-run restart", () => {
  it("retries failed Git-private state with a fresh runner instance", async () => {
    const root = await mkdtemp(`${tmpdir()}/striker-restart-git-`);
    await execFileAsync("git", ["-C", root, "init"]);
    const git = new GitCliRepository();
    const stateRoot = await git.resolvePrivatePath(root, "striker");
    const journal = new FileRunJournal(stateRoot);
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(new RestartSource()),
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

    const retryRunner = new FakeAgentRunner({
      output: "done",
      session: { id: "runtime-second", resumeId: "provider-second" },
      status: "returned",
    });
    await expect(
      new Dispatcher({ adapters, git, journal, runner: retryRunner }).retry(),
    ).resolves.toMatchObject({ status: "completed" });

    expect(firstRunner.requests).toHaveLength(1);
    expect(retryRunner.requests).toHaveLength(1);
    expect(retryRunner.resumeRequests).toHaveLength(0);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});
