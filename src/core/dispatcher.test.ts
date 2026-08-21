import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AdapterRegistry, Dispatcher } from "../index.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import type {
  AgentRequest,
  AgentRunner,
  GitRepository,
  GitState,
  Verifier,
} from "./contracts.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";

const task = {
  identity: { id: "slice-01", revision: "rev-1" },
  title: "Bootstrap the dispatch core",
  instructions: "Implement slice 01.",
} as const;

function state(overrides: Partial<GitState> = {}): GitState {
  return {
    dirtyPaths: [],
    head: "before",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
    ...overrides,
  };
}

class FakeGit implements GitRepository {
  constructor(private readonly states: readonly GitState[]) {}
  private index = 0;

  commitsBetween(): Promise<readonly string[]> {
    return Promise.resolve(["after"]);
  }

  inspect(): Promise<GitState> {
    const value = this.states[this.index] ?? this.states.at(-1);
    this.index += 1;
    if (value === undefined) throw new Error("Missing fake Git state");
    return Promise.resolve(value);
  }

  resolvePrivatePath(): Promise<string> {
    return Promise.resolve("/repo/.git/striker");
  }

  resolveRoot(): Promise<string> {
    return Promise.resolve("/repo");
  }
}

function verifier(exitCode: number): Verifier {
  return {
    verify: ({ command }) =>
      Promise.resolve({
        command,
        exitCode,
        output: exitCode === 0 ? "ok" : "no",
      }),
  };
}

function registryWithEvidence(summary?: string): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter(
      "memory",
      [task],
      summary === undefined ? {} : { "slice-01": { summary } },
    ),
  );
  return registry;
}

describe("Dispatcher", () => {
  it("dispatches one task and returns source-backed completion evidence", async () => {
    const evidence = { summary: "slice 01 is complete" } as const;
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(evidence.summary),
      journal,
      runner: new FakeAgentRunner({
        output: "Implementation finished.",
        session: { id: "session-1" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-1",
      skills: ["next-slice"],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toEqual({
      evidence,
      runId: "run-1",
      session: { id: "session-1" },
      status: "completed",
      task,
    });
    expect(journal.deletedRunIds).toEqual(["run-1"]);
  });

  it("needs attention when the source has no completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(),
      journal,
      runner: new FakeAgentRunner({
        output: "This output is not completion proof.",
        session: { id: "session-2" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-2",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("needs_attention");
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(journal.deletedRunIds).toEqual([]);
  });

  it("persists a failed agent turn without accepting completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence("would otherwise complete"),
      journal,
      runner: new FakeAgentRunner({
        error: "agent process exited",
        session: { id: "session-3" },
        status: "failed",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-3",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("failed");
    expect(journal.snapshots.at(-1)?.status).toBe("failed");
    expect(journal.deletedRunIds).toEqual([]);
  });
});

describe("Dispatcher sequential execution", () => {
  it("dispatches every task sequentially with a fresh session", async () => {
    const secondTask = {
      identity: { id: "slice-02", revision: "rev-2" },
      instructions: "Implement slice 02.",
      title: "Finish the dispatch core",
    } as const;
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [task, secondTask], {
        "slice-01": { summary: "slice 01 complete" },
        "slice-02": { summary: "slice 02 complete" },
      }),
    );
    const runner = new FakeAgentRunner([
      {
        output: "first done",
        session: { id: "session-1" },
        status: "returned",
      },
      {
        output: "second done",
        session: { id: "session-2" },
        status: "returned",
      },
    ]);
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch({
      completedTasks: [],
      runId: "run-all",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toMatchObject({ status: "completed", task: secondTask });
    expect(runner.requests).toHaveLength(2);
    expect(
      journal.events
        .filter((event) => event.type === "task_completed")
        .map((event) => event.session.id),
    ).toEqual(["session-1", "session-2"]);
    expect(
      journal.events.filter((event) => event.type === "run_started"),
    ).toHaveLength(1);
    expect(journal.deletedRunIds).toEqual(["run-all"]);
    expect(runner.preflightRequests).toEqual([{ skills: [] }]);
  });

  it("does not start task work or a journal after failed preflight", async () => {
    const journal = new InMemoryRunJournal();
    const runner: AgentRunner = {
      preflight: () => Promise.reject(new Error('Harness "pi" is unavailable')),
      resumeSession: () => {
        throw new Error("Task session must not resume");
      },
      runInNewSession: () => {
        throw new Error("Task session must not start");
      },
    };
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence("complete"),
      journal,
      runner,
    });

    await expect(
      dispatcher.dispatch({
        completedTasks: [],
        runId: "run-preflight",
        skills: ["security"],
        taskSource: { location: "memory://plan", type: "memory" },
      }),
    ).rejects.toThrow('Harness "pi" is unavailable');
    expect(journal.events).toEqual([]);
    expect(journal.snapshots).toEqual([]);
  });
});

describe("Dispatcher journal recovery", () => {
  it("resumes at the first task absent from the durable journal", async () => {
    const secondTask = {
      identity: { id: "slice-02", revision: "rev-2" },
      instructions: "Implement slice 02.",
      title: "Finish the dispatch core",
    } as const;
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [task, secondTask], {
        "slice-02": { summary: "slice 02 complete" },
      }),
    );
    const journal = new InMemoryRunJournal();
    await journal.append({ runId: "run-resume", type: "run_started" });
    await journal.append({
      runId: "run-resume",
      session: { id: "old-session" },
      task: task.identity,
      type: "task_completed",
    });
    const runner = new FakeAgentRunner({
      output: "second done",
      session: { id: "new-session" },
      status: "returned",
    });
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch({
      completedTasks: [],
      runId: "run-resume",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toMatchObject({ status: "completed", task: secondTask });
    expect(runner.lastRequest?.instructions).toBe(secondTask.instructions);
  });

  it("needs attention when a completed task identity changed", async () => {
    const changedTask = {
      ...task,
      identity: { id: task.identity.id, revision: "changed-revision" },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [changedTask], {}),
    );
    const journal = new InMemoryRunJournal();
    await journal.append({ runId: "run-changed", type: "run_started" });
    await journal.append({
      runId: "run-changed",
      session: { id: "old-session" },
      task: task.identity,
      type: "task_completed",
    });
    const runner = new FakeAgentRunner({
      output: "unused",
      session: { id: "unused" },
      status: "returned",
    });
    const dispatcher = new Dispatcher({ adapters: registry, journal, runner });

    const result = await dispatcher.dispatch({
      completedTasks: [],
      runId: "run-changed",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toEqual({
      completedTask: task.identity,
      currentTask: changedTask.identity,
      reason: "completed_task_changed",
      runId: "run-changed",
      session: null,
      status: "needs_attention",
      task: null,
    });
    expect(runner.requests).toEqual([]);
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
  });
});

describe("Dispatcher execution evidence", () => {
  it("keeps the private workflow separate and pauses on failed verification", async () => {
    const executionTask = {
      ...task,
      execution: {
        affectedPaths: ["src/cli.ts"],
        cwd: "/repo",
        verifyCommand: "pnpm test",
        workflowInstructions: "private workflow",
      },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [executionTask], {
        "slice-01": { summary: "complete" },
      }),
    );
    const runner = new FakeAgentRunner({
      output: "done",
      session: { id: "session-4" },
      status: "returned",
    });
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registry,
      git: new FakeGit([state(), state({ head: "after" })]),
      journal,
      runner,
      verifier: verifier(1),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-4",
      skills: ["security"],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toMatchObject({
      reason: "verification_failed",
      status: "needs_attention",
    });
    expect(runner.lastRequest).toEqual({
      instructions: task.instructions,
      skills: ["security"],
      workflowInstructions: "private workflow",
    });
    expect(journal.deletedRunIds).toEqual([]);
  });
});

describe("Dispatcher dirty baseline", () => {
  it("rejects a task that overlaps the preserved dirty baseline", async () => {
    const executionTask = {
      ...task,
      execution: {
        affectedPaths: ["src/cli.ts"],
        cwd: "/repo",
        verifyCommand: "pnpm test",
        workflowInstructions: "private workflow",
      },
    };
    const registry = new AdapterRegistry();
    registry.register(
      new InMemoryTaskSourceAdapter("memory", [executionTask], {}),
    );
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registry,
      git: new FakeGit([state({ dirtyPaths: ["src/cli.ts"] })]),
      journal,
      runner: new FakeAgentRunner({
        output: "unused",
        session: { id: "unused" },
        status: "returned",
      }),
      verifier: verifier(0),
    });

    await expect(
      dispatcher.dispatchOne({
        allowDirty: true,
        completedTasks: [],
        runId: "run-5",
        skills: [],
        taskSource: { location: "memory://plan", type: "memory" },
      }),
    ).rejects.toThrow("Task overlaps dirty path: src/cli.ts");
    expect(journal.events).toEqual([]);
  });
});

function planTask(title: string, affectedPath: string): string {
  return `# ${title}\n\n## Build\n\nImplement ${title}.\n\n## Paths\n\n- Modify \`${affectedPath}\`\n\n## Test contract\n\n- Test ${title}.\n\n## Verify\n\n\`\`\`sh\npnpm test\n\`\`\`\n`;
}

async function createChangingPlan() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-sequence-"));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
  ]);
  const manifest = (tasks: readonly string[]) =>
    JSON.stringify({ taskSource: "striker-plan", tasks, version: 1 });
  await Promise.all([
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
    writeFile(path.join(planRoot, "log.md"), "# Log\n"),
    writeFile(
      path.join(planRoot, "tasks/01.md"),
      planTask("First", "src/first.ts"),
    ),
    writeFile(
      path.join(planRoot, "tasks/02.md"),
      planTask("Second", "src/second.ts"),
    ),
    writeFile(
      path.join(workflowRoot, "SKILL.md"),
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nworkflow",
    ),
    writeFile(path.join(workflowRoot, "references/tdd.md"), "tdd"),
    writeFile(path.join(workflowRoot, "references/review.md"), "review"),
    writeFile(
      path.join(planRoot, "plan.json"),
      manifest(["tasks/01.md", "tasks/02.md"]),
    ),
  ]);
  return { manifest, planRoot, root, workflowRoot };
}

class ChangingPlanRunner implements AgentRunner {
  #active = 0;
  maximumActive = 0;
  readonly requests: AgentRequest[] = [];

  constructor(
    private readonly planRoot: string,
    private readonly manifest: (tasks: readonly string[]) => string,
  ) {}

  preflight(): Promise<void> {
    return Promise.resolve();
  }

  resumeSession(): never {
    throw new Error("Changing plan runner does not resume sessions");
  }

  async runInNewSession(request: AgentRequest) {
    this.#active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.#active);
    this.requests.push(request);
    await appendFile(
      path.join(this.planRoot, "log.md"),
      `\nHuman ${String(this.requests.length)}.\n`,
    );
    if (this.requests.length === 1) {
      await writeFile(
        path.join(this.planRoot, "tasks/03.md"),
        planTask("Inserted", "src/inserted.ts"),
      );
      await writeFile(
        path.join(this.planRoot, "plan.json"),
        this.manifest(["tasks/01.md", "tasks/03.md", "tasks/02.md"]),
      );
    }
    this.#active -= 1;
    return {
      output: 'done\nSTRIKER_REVIEWS {"standards":"passed","plan":"passed"}',
      session: { id: `session-${String(this.requests.length)}` },
      status: "returned" as const,
    };
  }
}

describe("Dispatcher with a changing Striker plan", () => {
  it("rescans committed plan order without overlapping task sessions", async () => {
    const { manifest, planRoot, root, workflowRoot } =
      await createChangingPlan();
    const runner = new ChangingPlanRunner(planRoot, manifest);
    const registry = new AdapterRegistry();
    registry.register(
      new StrikerPlanAdapter({ projectRoot: root, workflowRoot }),
    );
    const journal = new InMemoryRunJournal();
    const gitStates = ["0", "1", "1", "2", "2", "3"].map((head) =>
      state({ head, root }),
    );
    const result = await new Dispatcher({
      adapters: registry,
      git: new FakeGit(gitStates),
      journal,
      runner,
      verifier: verifier(0),
    }).dispatch({
      completedTasks: [],
      runId: "changing",
      skills: [],
      taskSource: { location: planRoot, type: "striker-plan" },
    });

    expect(result).toMatchObject({
      status: "completed",
      task: { identity: { id: "tasks/02.md" } },
    });
    expect(
      runner.requests.map(
        (request) => /^# ([^\n]+)/.exec(request.instructions)?.[1],
      ),
    ).toEqual(["First", "Inserted", "Second"]);
    expect(runner.maximumActive).toBe(1);
    expect(journal.deletedRunIds).toEqual(["changing"]);
  });
});
