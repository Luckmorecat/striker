import { mkdtemp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { GitState, TaskExecutionEvidence } from "../../core/contracts.js";
import { StrikerPlanAdapter } from "./striker-plan-adapter.js";

const taskText = `# Build the command

## Build

Add the command.

## Paths

- Modify \`src/cli.ts\`
- Create \`src/cli/run.ts\`

## Test contract

- Test the public command.

## Verify

\`\`\`sh
pnpm test
\`\`\`
`;

function manifest(tasks = ["tasks/01.md"]): string {
  return JSON.stringify({
    assumptions: {
      A1: {
        evidence: [{ line: 1, path: "src/cli.ts" }],
        statement: "The CLI owns command registration.",
      },
    },
    defaults: {
      D1: {
        reason: "Keep the public command stable.",
        reversalCost: "Rename the command and tests.",
        statement: "Retain the command name.",
      },
    },
    taskSource: "striker-plan",
    tasks,
    version: 2,
  });
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-adapter-"));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(planRoot, "plan.json"), manifest()),
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
    writeFile(path.join(planRoot, "tasks/01.md"), taskText),
    writeFile(
      path.join(workflowRoot, "SKILL.md"),
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nprivate workflow",
    ),
    writeFile(path.join(workflowRoot, "references/tdd.md"), "tdd rules"),
  ]);
  return { planRoot, root, workflowRoot };
}

function gitState(root: string, head: string): GitState {
  return {
    dirtyPaths: [],
    head,
    root,
    trackedPatch: "",
    untrackedHashes: {},
  };
}

describe("Striker plan adapter", () => {
  it("selects the first unmarked task with execution instructions", async () => {
    const fixture = await createFixture();
    const source = await new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    }).open(fixture.planRoot);

    const task = await source.nextTask([]);

    expect(task).toMatchObject({
      execution: {
        affectedPaths: ["src/cli.ts", "src/cli/run.ts"],
        cwd: fixture.root,
        verifyCommand: "pnpm test",
      },
      identity: { id: "tasks/01.md" },
    });
    expect(task?.execution?.workflowInstructions).toContain("private workflow");
    expect(task?.execution?.workflowInstructions).not.toContain(
      "Sequential review",
    );
    expect(task?.instructions).toContain(`Plan root: ${fixture.planRoot}`);
  });
});

describe("Striker plan completion evidence", () => {
  it("requires one strict implementation result without trusting reviews", async () => {
    const fixture = await createFixture();
    const adapter = new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    });
    const source = await adapter.open(fixture.planRoot);
    const task = await source.nextTask([]);
    if (task === null) throw new Error("Expected a task");
    const before = gitState(fixture.root, "before");
    const after = gitState(fixture.root, "after");
    const execution: TaskExecutionEvidence = {
      after,
      before,
      changedPaths: ["src/cli.ts"],
      commits: ["after"],
      verification: { command: "pnpm test", exitCode: 0, output: "ok" },
    };

    const resumedSource = await adapter.open(fixture.planRoot);
    await expect(
      resumedSource.completionEvidence(task, execution, "done"),
    ).resolves.toMatchObject({
      attention: { reason: "completion_evidence_missing" },
      status: "needs_attention",
    });
    await expect(
      resumedSource.completionEvidence(
        task,
        execution,
        '{"discoveries":[],"kind":"implementation","summary":"done"} but more prose',
      ),
    ).resolves.toMatchObject({
      attention: { reason: "completion_evidence_missing" },
      status: "needs_attention",
    });
    const result = await resumedSource.completionEvidence(
      task,
      execution,
      '{"discoveries":[],"kind":"implementation","summary":"Added the command."}',
    );
    expect(result.status).toBe("completed");
    if (result.status !== "completed")
      throw new Error("Expected completion evidence");
    expect(result.evidence.verification?.exitCode).toBe(0);
    expect(result.evidence.summary).toBe("Added the command.");

    await expect(resumedSource.nextTask([task.identity])).resolves.toBeNull();
  });
});

describe("Striker plan discovery evidence", () => {
  it("accepts proposals only for ledger entries in the immutable plan", async () => {
    const fixture = await createFixture();
    const source = await new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    }).open(fixture.planRoot);
    const task = await source.nextTask([]);
    if (task === null) throw new Error("Expected a task");
    const execution: TaskExecutionEvidence = {
      after: gitState(fixture.root, "after"),
      before: gitState(fixture.root, "before"),
      changedPaths: ["src/cli.ts"],
      commits: ["after"],
      verification: { command: "pnpm test", exitCode: 0, output: "ok" },
    };
    const proposal = {
      id: "A1",
      kind: "assumption",
      locator: {
        kind: "code",
        line: 1,
        path: "src/cli.ts",
        text: "evidence",
      },
      reason: "The CLI owns registration.",
      state: "confirmed",
    } as const;
    const accepted = await source.completionEvidence(
      task,
      execution,
      JSON.stringify({
        discoveries: [proposal],
        kind: "implementation",
        summary: "Added the command.",
      }),
    );
    expect(accepted).toMatchObject({
      evidence: { discoveries: [proposal] },
      status: "completed",
    });

    const unknown = await source.completionEvidence(
      task,
      execution,
      JSON.stringify({
        discoveries: [{ ...proposal, id: "A2" }],
        kind: "implementation",
        summary: "Added the command.",
      }),
    );
    expect(unknown).toMatchObject({
      attention: {
        detail: "Unknown plan assumption: A2",
        reason: "completion_evidence_missing",
      },
      status: "needs_attention",
    });
  });
});

describe("Striker plan completion reconciliation", () => {
  it("keeps reconciliation read-only", async () => {
    const fixture = await createFixture();
    const source = await new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    }).open(fixture.planRoot);
    const task = await source.nextTask([]);
    if (task === null) throw new Error("Expected a task");
    const immutablePaths = ["plan.json", "spine.md", "map.md", "tasks/01.md"];
    const before = await Promise.all(
      immutablePaths.map((file) =>
        readFile(path.join(fixture.planRoot, file), "utf8"),
      ),
    );

    await expect(
      source.reconcileCompleted([task.identity]),
    ).resolves.toBeNull();
    await expect(
      Promise.all(
        immutablePaths.map((file) =>
          readFile(path.join(fixture.planRoot, file), "utf8"),
        ),
      ),
    ).resolves.toEqual(before);
  });

  it("replays durable completions and reports changed identities", async () => {
    const fixture = await createFixture();
    const adapter = new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    });
    const original = await adapter.open(fixture.planRoot);
    const task = await original.nextTask([]);
    if (task === null) throw new Error("Expected a task");

    await expect(
      original.reconcileCompleted([task.identity]),
    ).resolves.toBeNull();
    await expect(original.nextTask([task.identity])).resolves.toBeNull();

    await writeFile(
      path.join(fixture.planRoot, "tasks/01.md"),
      taskText.replace("Add the command.", "Add the changed command."),
    );
    const changed = await adapter.open(fixture.planRoot);
    const conflict = await changed.reconcileCompleted([task.identity]);
    expect(conflict?.completed).toEqual(task.identity);
    expect(conflict?.current?.id).toBe(task.identity.id);

    await unlink(path.join(fixture.planRoot, "tasks/01.md"));
    await writeFile(
      path.join(fixture.planRoot, "tasks/02.md"),
      taskText.replace("Build the command", "Build another command"),
    );
    await writeFile(
      path.join(fixture.planRoot, "plan.json"),
      manifest(["tasks/02.md"]),
    );
    const removed = await adapter.open(fixture.planRoot);
    await expect(removed.reconcileCompleted([task.identity])).resolves.toEqual({
      completed: task.identity,
      current: null,
    });
  });
});
