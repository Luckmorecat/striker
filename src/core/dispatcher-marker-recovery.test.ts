import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { GitCliRepository } from "../infrastructure/git-cli.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  ImplementationTask,
  RunJournalEvent,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const execFileAsync = promisify(execFile);
const immutablePlanPaths = [
  "plan.json",
  "spine.md",
  "map.md",
  "tasks/01.md",
  "tasks/02.md",
] as const;

async function git(root: string, ...arguments_: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...arguments_]);
}

function readImmutablePlan(planRoot: string): Promise<string[]> {
  return Promise.all(
    immutablePlanPaths.map((file) =>
      readFile(path.join(planRoot, file), "utf8"),
    ),
  );
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
    writeFile(
      path.join(planRoot, "plan.json"),
      JSON.stringify({
        assumptions: {},
        defaults: {},
        taskSource: "striker-plan",
        tasks: options.tasks.map((task) => task.path),
        version: 2,
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

async function appendCompletedAttempt(
  journal: FileRunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  session: AgentSession,
  changedPaths: readonly string[],
): Promise<void> {
  const events: readonly RunJournalEvent[] = [
    {
      planId: request.planId,
      request,
      runId: request.runId,
      type: "run_started",
    },
    { runId: request.runId, task, type: "task_selected" },
    {
      before: null,
      runId: request.runId,
      task: task.identity,
      type: "task_baseline_recorded",
    },
    {
      attempt: 1,
      runId: request.runId,
      task: task.identity,
      type: "task_attempt_started",
    },
    {
      attempt: 1,
      runId: request.runId,
      session,
      task: task.identity,
      type: "task_session_started",
    },
    {
      attempt: 1,
      changedPaths,
      completedAt: "2026-08-22T12:00:00.000Z",
      resultCommit: "after",
      runId: request.runId,
      session,
      startCommit: "before",
      task: task.identity,
      type: "task_completed",
      verification: {
        command: task.execution?.verifyCommand ?? "pnpm check",
        exitCode: 0,
        output: "ok",
      },
    },
  ];
  for (const event of events) await journal.append(event);
}

describe("Dispatcher completed-event recovery", () => {
  it("uses the durable completion before selecting another task", async () => {
    const fixture = await recoveryFixture();
    const plan = await parseStrikerPlan(fixture.planRoot);
    const journal = new FileRunJournal(path.join(fixture.root, "state"));
    const session = { id: "runtime-session", resumeId: "provider-session" };
    const request = {
      completedTasks: [],
      planId: plan.identity,
      runId: "run-marker",
      skills: [],
      taskSource: { location: fixture.planRoot, type: "striker-plan" },
    } as const;
    await appendCompletedAttempt(journal, request, fixture.task, session, [
      "src/recover.ts",
    ]);
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

    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher finalization recovery", () => {
  it("does not delegate terminal writes to the task source", async () => {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "striker-finalization-retry-"),
    );
    const journal = new FileRunJournal(stateRoot);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Complete the task.",
      title: "Complete the task",
    };
    let finalized = false;
    const source: TaskSource & { finalizeCompleted(): Promise<void> } = {
      completionEvidence: () =>
        Promise.resolve({
          evidence: { summary: "task complete" },
          status: "completed",
        }),
      finalizeCompleted: () => {
        finalized = true;
        return Promise.reject(new Error("task source must stay read-only"));
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
    const dispatcher = new Dispatcher({ adapters, journal, runner });
    const request = {
      completedTasks: [],
      planId: "run-finalization-retry",
      runId: "run-finalization-retry",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    } as const;

    await appendCompletedAttempt(journal, request, task, session, [
      "src/task.ts",
    ]);

    await expect(dispatcher.resume()).resolves.toMatchObject({
      status: "source_exhausted",
    });
    expect(finalized).toBe(false);
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("Dispatcher immutable multi-task plans", () => {
  it("runs two Git tasks without modifying plan files", async () => {
    const fixture = await twoTaskFixture();
    const plan = await parseStrikerPlan(fixture.planRoot);
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
    const planBefore = await readImmutablePlan(fixture.planRoot);
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
        const target = `src/task-${String(sessionCount)}.txt`;
        await writeFile(path.join(fixture.root, target), "complete\n");
        await git(fixture.root, "add", "--", target);
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
      planId: plan.identity,
      runId: "run-two-task",
      skills: [],
      taskSource: { location: fixture.planRoot, type: "striker-plan" },
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(sessionCount).toBe(2);
    await expect(readImmutablePlan(fixture.planRoot)).resolves.toEqual(
      planBefore,
    );
    await expect(journal.loadActive()).resolves.toBeNull();
    await expect(journal.load(plan.identity)).resolves.toMatchObject({
      completedTasks: plan.tasks.map((task) => task.identity),
      lastEvent: { type: "run_completed" },
      snapshot: { status: "completed" },
    });
  });
});
