import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { InMemoryRunJournal } from "../testing/fakes.js";
import { AdapterRegistry, Dispatcher } from "../index.js";
import type {
  AgentRequest,
  AgentRunner,
  AgentSession,
  GitRepository,
  GitState,
  Verifier,
} from "./contracts.js";

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

function verifier(): Verifier {
  return {
    verify: ({ command }) =>
      Promise.resolve({ command, exitCode: 0, output: "ok" }),
  };
}

function planTask(title: string, affectedPath: string): string {
  return `# ${title}\n\n## Build\n\nImplement ${title}.\n\n## Paths\n\n- Modify \`${affectedPath}\`\n\n## Test contract\n\n- Test ${title}.\n\n## Verify\n\n\`\`\`sh\npnpm test\n\`\`\`\n`;
}

async function createOrderedPlan() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-sequence-"));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
  ]);
  const manifest = (tasks: readonly string[]) =>
    JSON.stringify({
      assumptions: {},
      defaults: {},
      taskSource: "striker-plan",
      tasks,
      version: 2,
    });
  await Promise.all([
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
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
  return { planRoot, root, workflowRoot };
}

class OrderedPlanRunner implements AgentRunner {
  #active = 0;
  maximumActive = 0;
  readonly requests: AgentRequest[] = [];

  preflight(): Promise<void> {
    return Promise.resolve();
  }

  resumeSession(): never {
    throw new Error("Changing plan runner does not resume sessions");
  }

  async runInNewSession(
    request: AgentRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ) {
    this.#active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.#active);
    this.requests.push(request);
    this.#active -= 1;
    const session = { id: `session-${String(this.requests.length)}` };
    await sessionStarted?.(session);
    return {
      output: 'done\nSTRIKER_REVIEWS {"standards":"passed","plan":"passed"}',
      session,
      status: "returned" as const,
    };
  }
}

describe("Dispatcher with an immutable Striker plan", () => {
  it("runs declared task order without overlapping task sessions", async () => {
    const { planRoot, root, workflowRoot } = await createOrderedPlan();
    const runner = new OrderedPlanRunner();
    const registry = new AdapterRegistry();
    registry.register(
      new StrikerPlanAdapter({ projectRoot: root, workflowRoot }),
    );
    const journal = new InMemoryRunJournal();
    const gitStates = ["0", "1", "1", "2"].map((head) => state({ head, root }));
    const result = await new Dispatcher({
      adapters: registry,
      git: new FakeGit(gitStates),
      journal,
      runner,
      verifier: verifier(),
    }).dispatch({
      completedTasks: [],
      planId: "changing",
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
    ).toEqual(["First", "Second"]);
    expect(runner.maximumActive).toBe(1);
    expect(journal.releasedRunIds).toEqual(["changing"]);
  });
});
