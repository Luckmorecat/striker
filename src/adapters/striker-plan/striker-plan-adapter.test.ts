import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { GitState, TaskExecutionEvidence } from "../../core/contracts.js";
import { readCompletionMarkers } from "./completion-marker.js";
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

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-adapter-"));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(planRoot, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/01.md"],
        version: 1,
      }),
    ),
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
    writeFile(path.join(planRoot, "log.md"), "# Log\n"),
    writeFile(path.join(planRoot, "tasks/01.md"), taskText),
    writeFile(
      path.join(workflowRoot, "SKILL.md"),
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nprivate workflow",
    ),
    writeFile(path.join(workflowRoot, "references/tdd.md"), "tdd rules"),
    writeFile(path.join(workflowRoot, "references/review.md"), "review rules"),
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
        affectedPaths: [
          "src/cli.ts",
          "src/cli/run.ts",
          "plan/spine.md",
          "plan/map.md",
          "plan/log.md",
        ],
        cwd: fixture.root,
        verifyCommand: "pnpm test",
      },
      identity: { id: "tasks/01.md" },
    });
    expect(task?.execution?.workflowInstructions).toContain("private workflow");
    expect(task?.execution?.workflowInstructions).toContain(
      'STRIKER_REVIEWS {"standards":"passed","plan":"passed"}',
    );
    expect(task?.instructions).toContain(`Plan root: ${fixture.planRoot}`);
  });
});

describe("Striker plan completion evidence", () => {
  it("requires a human log addition before writing completion", async () => {
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
      commits: ["after"],
      verification: { command: "pnpm test", exitCode: 0, output: "ok" },
    };

    await expect(
      source.completionEvidence(task, execution, ""),
    ).resolves.toMatchObject({
      attention: { reason: "human_log_missing" },
      status: "needs_attention",
    });
    await appendFile(
      path.join(fixture.planRoot, "log.md"),
      "\nHuman result.\n",
    );
    const resumedSource = await adapter.open(fixture.planRoot);
    await expect(
      resumedSource.completionEvidence(task, execution, "done"),
    ).resolves.toMatchObject({
      attention: { reason: "review_evidence_missing" },
      status: "needs_attention",
    });
    await expect(
      resumedSource.completionEvidence(
        task,
        execution,
        'STRIKER_REVIEWS {"standards":"passed","plan":"passed"} but review failed',
      ),
    ).resolves.toMatchObject({
      attention: { reason: "review_evidence_missing" },
      status: "needs_attention",
    });
    const result = await resumedSource.completionEvidence(
      task,
      execution,
      'done\nSTRIKER_REVIEWS {"standards":"passed","plan":"passed"}',
    );
    expect(result.status).toBe("completed");
    if (result.status !== "completed")
      throw new Error("Expected completion evidence");
    expect(result.evidence.verification?.exitCode).toBe(0);

    await resumedSource.finalizeCompleted?.([task.identity]);
    await expect(resumedSource.nextTask([])).resolves.toBeNull();
  });
});

describe("Striker plan completion reconciliation", () => {
  it("keeps reconciliation read-only and finalizes markers idempotently", async () => {
    const fixture = await createFixture();
    const source = await new StrikerPlanAdapter({
      projectRoot: fixture.root,
      workflowRoot: fixture.workflowRoot,
    }).open(fixture.planRoot);
    const task = await source.nextTask([]);
    if (task === null) throw new Error("Expected a task");
    const logPath = path.join(fixture.planRoot, "log.md");
    const before = await readFile(logPath, "utf8");

    await expect(
      source.reconcileCompleted([task.identity]),
    ).resolves.toBeNull();
    await expect(readFile(logPath, "utf8")).resolves.toBe(before);

    await source.finalizeCompleted?.([task.identity]);
    await source.finalizeCompleted?.([task.identity]);
    await expect(readCompletionMarkers(logPath)).resolves.toEqual([
      task.identity,
    ]);
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
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/02.md"],
        version: 1,
      }),
    );
    const removed = await adapter.open(fixture.planRoot);
    await expect(removed.reconcileCompleted([task.identity])).resolves.toEqual({
      completed: task.identity,
      current: null,
    });
  });
});
