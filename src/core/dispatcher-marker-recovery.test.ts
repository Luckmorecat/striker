import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readCompletionMarkers } from "../adapters/striker-plan/completion-marker.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { AgentRunner } from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

async function recoveryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-marker-recovery-"));
  const planRoot = path.join(root, "plan");
  const workflowRoot = path.join(root, "workflow");
  await Promise.all([
    mkdir(path.join(planRoot, "tasks"), { recursive: true }),
    mkdir(path.join(workflowRoot, "references"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(planRoot, "spine.md"), "# Spine\n"),
    writeFile(path.join(planRoot, "map.md"), "# Map\n"),
    writeFile(path.join(planRoot, "log.md"), "# Log\n\nTask complete.\n"),
    writeFile(
      path.join(planRoot, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/01.md"],
        version: 1,
      }),
    ),
    writeFile(
      path.join(planRoot, "tasks/01.md"),
      "# Recover marker\n\n## Build\n\nRecover it.\n\n## Paths\n\n- Modify `src/recover.ts`\n\n## Test contract\n\n- Test recovery.\n\n## Verify\n\n```sh\npnpm test\n```\n",
    ),
    writeFile(
      path.join(workflowRoot, "SKILL.md"),
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nWorkflow.\n",
    ),
    writeFile(path.join(workflowRoot, "references/tdd.md"), "TDD.\n"),
    writeFile(path.join(workflowRoot, "references/review.md"), "Review.\n"),
  ]);
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
