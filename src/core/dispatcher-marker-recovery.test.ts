import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { readCompletionMarkers } from "../adapters/striker-plan/completion-marker.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { AgentRunner, TaskIdentity, TaskSource } from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...arguments_: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...arguments_]);
}

function taskText(title: string, target: string): string {
  return `# ${title}

## Build

Write the task output.

## Paths

- Modify \`${target}\`

## Test contract

- Check the task output.

## Verify

\`\`\`sh
true
\`\`\`
`;
}

interface PlanFixtureOptions {
  readonly initializeGit?: boolean;
  readonly log: string;
  readonly prefix: string;
  readonly projectFiles?: Readonly<Record<string, string>>;
  readonly tasks: readonly {
    readonly content: string;
    readonly path: string;
  }[];
}

async function planFixture(options: PlanFixtureOptions) {
  const root = await mkdtemp(path.join(tmpdir(), options.prefix));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  const projectFiles = Object.entries(options.projectFiles ?? {});
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
    ...projectFiles.map(([file]) =>
      mkdir(path.dirname(path.join(root, file)), { recursive: true }),
    ),
  ]);
  await Promise.all([
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
    writeFile(path.join(planRoot, "log.md"), options.log),
    writeFile(
      path.join(planRoot, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: options.tasks.map((task) => task.path),
        version: 1,
      }),
    ),
    ...options.tasks.map((task) =>
      writeFile(path.join(planRoot, task.path), task.content),
    ),
    ...projectFiles.map(([file, content]) =>
      writeFile(path.join(root, file), content),
    ),
    writeFile(
      path.join(workflowRoot, "SKILL.md"),
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nWorkflow.\n",
    ),
    writeFile(path.join(workflowRoot, "references/tdd.md"), "TDD.\n"),
    writeFile(path.join(workflowRoot, "references/review.md"), "Review.\n"),
  ]);
  if (options.initializeGit === true) {
    await git(root, "init", "-q");
    await git(root, "config", "user.name", "Striker Test");
    await git(root, "config", "user.email", "striker@example.test");
    await git(root, "add", ".");
    await git(root, "commit", "-qm", "initial");
  }
  return { planRoot, root, workflowRoot };
}

function twoTaskFixture() {
  return planFixture({
    initializeGit: true,
    log: "# Log\n",
    prefix: "striker-two-task-",
    projectFiles: {
      "src/task-1.txt": "initial\n",
      "src/task-2.txt": "initial\n",
    },
    tasks: [
      {
        content: taskText("Write task one", "src/task-1.txt"),
        path: "tasks/01.md",
      },
      {
        content: taskText("Write task two", "src/task-2.txt"),
        path: "tasks/02.md",
      },
    ],
  });
}

async function recoveryFixture() {
  const { planRoot, root, workflowRoot } = await planFixture({
    log: "# Log\n\nTask complete.\n",
    prefix: "striker-marker-recovery-",
    tasks: [
      {
        content:
          "# Recover marker\n\n## Build\n\nRecover it.\n\n## Paths\n\n- Modify `src/recover.ts`\n\n## Test contract\n\n- Test recovery.\n\n## Verify\n\n```sh\npnpm test\n```\n",
        path: "tasks/01.md",
      },
    ],
  });
  const adapter = new StrikerPlanAdapter({ projectRoot: root, workflowRoot });
  const source = await adapter.open(planRoot);
  const task = await source.nextTask([]);
  if (task === null) throw new Error("Missing fixture task");
  return { adapter, planRoot, root, task };
}

describe("Dispatcher completed-event recovery", () => {
  it("restores a missing plan marker before selecting another task", async () => {
    const fixture = await recoveryFixture();
    const journal = new FileRunJournal(path.join(fixture.root, "state"));
    const session = { id: "runtime-session", resumeId: "provider-session" };
    const request = {
      completedTasks: [],
      runId: "run-marker",
      skills: [],
      taskSource: { location: fixture.planRoot, type: "striker-plan" },
    } as const;
    await journal.append({ runId: request.runId, type: "run_started" });
    await journal.replace({
      attempt: 1,
      before: null,
      request,
      runId: request.runId,
      session,
      status: "running",
      task: fixture.task,
    });
    await journal.append({
      evidence: { summary: "task complete" },
      runId: request.runId,
      session,
      task: fixture.task.identity,
      type: "task_completed",
    });
    const adapters = new AdapterRegistry();
    adapters.register(fixture.adapter);
    const runner: AgentRunner = {
      preflight: () => {
        throw new Error("Completed recovery must not preflight");
      },
      resumeSession: () => {
        throw new Error("Completed recovery must not resume a session");
      },
      runInNewSession: () => {
        throw new Error("Completed recovery must not start a session");
      },
    };

    await expect(
      new Dispatcher({ adapters, journal, runner }).resume(),
    ).resolves.toMatchObject({ status: "source_exhausted" });

    await expect(
      readCompletionMarkers(path.join(fixture.planRoot, "log.md")),
    ).resolves.toEqual([fixture.task.identity]);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher finalization recovery", () => {
  it("retains dispatchOne state and retries failed finalization on resume", async () => {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "striker-finalization-retry-"),
    );
    const journal = new FileRunJournal(stateRoot);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Complete the task.",
      title: "Complete the task",
    };
    let attempts = 0;
    let finalized: readonly TaskIdentity[] = [];
    const source: TaskSource = {
      completionEvidence: () =>
        Promise.resolve({
          evidence: { summary: "task complete" },
          status: "completed",
        }),
      finalizeCompleted: (completed) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("disk full"));
        finalized = completed;
        return Promise.resolve();
      },
      nextTask: (completed) =>
        Promise.resolve(completed.length === 0 ? task : null),
      reconcileCompleted: () => Promise.resolve(null),
    };
    const adapters = new AdapterRegistry();
    adapters.register({
      open: () => Promise.resolve(source),
      type: "memory",
    });
    const session = { id: "session-1" };
    const runner: AgentRunner = {
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Completed recovery must not resume a session");
      },
      runInNewSession: async (_request, sessionStarted) => {
        await sessionStarted?.(session);
        return { output: "done", session, status: "returned" };
      },
    };
    const dispatcher = new Dispatcher({ adapters, journal, runner });
    const request = {
      completedTasks: [],
      runId: "run-finalization-retry",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;

    await expect(dispatcher.dispatchOne(request)).rejects.toThrow("disk full");
    await expect(journal.loadActive()).resolves.toMatchObject({
      completedTasks: [task.identity],
    });
    await expect(dispatcher.resume()).resolves.toMatchObject({
      status: "source_exhausted",
    });
    expect(attempts).toBe(2);
    expect(finalized).toEqual([task.identity]);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher multi-task marker finalization", () => {
  it("runs two Git tasks before finalizing their plan markers", async () => {
    const fixture = await twoTaskFixture();
    const repository = new GitCliRepository();
    const journal = new FileRunJournal(
      await repository.resolvePrivatePath(fixture.root, "striker"),
    );
    const adapters = new AdapterRegistry();
    adapters.register(
      new StrikerPlanAdapter({
        projectRoot: fixture.root,
        workflowRoot: fixture.workflowRoot,
      }),
    );
    const markerCounts: number[] = [];
    let sessionCount = 0;
    const runner: AgentRunner = {
      preflight: () => Promise.resolve(),
      resumeSession: () => {
        throw new Error("Two-task dispatch must not resume a session");
      },
      runInNewSession: async (_request, sessionStarted) => {
        sessionCount += 1;
        const session = { id: `session-${String(sessionCount)}` };
        await sessionStarted?.(session);
        const logPath = path.join(fixture.planRoot, "log.md");
        markerCounts.push((await readCompletionMarkers(logPath)).length);
        const target = `src/task-${String(sessionCount)}.txt`;
        await Promise.all([
          writeFile(path.join(fixture.root, target), "complete\n"),
          appendFile(logPath, `\nTask ${String(sessionCount)} complete.\n`),
        ]);
        await git(fixture.root, "add", "--", target, "plan/log.md");
        await git(
          fixture.root,
          "commit",
          "-qm",
          `complete task ${String(sessionCount)}`,
        );
        return {
          output:
            'done\nSTRIKER_REVIEWS {"standards":"passed","plan":"passed"}',
          session,
          status: "returned",
        };
      },
    };
    const result = await new Dispatcher({
      adapters,
      git: repository,
      journal,
      runner,
      verifier: {
        verify: ({ command }) =>
          Promise.resolve({ command, exitCode: 0, output: "ok" }),
      },
    }).dispatch({
      completedTasks: [],
      runId: "run-two-task",
      skills: [],
      taskSource: { location: fixture.planRoot, type: "striker-plan" },
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(sessionCount).toBe(2);
    expect(markerCounts).toEqual([0, 0]);
    await expect(
      readCompletionMarkers(path.join(fixture.planRoot, "log.md")),
    ).resolves.toHaveLength(2);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});
