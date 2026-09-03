import {
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DispatchRequest, RunJournalEvent } from "../core/contracts.js";
import { appendPassedStandardsReview } from "../testing/fakes.js";
import { FileRunJournal } from "./file-run-journal.js";
import { FilePlanLogReader } from "./plan-projections.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts", "src/task.test.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build it.",
  title: "Build task state",
};
const session = { id: "session-1", resumeId: "provider-1" };
const request: DispatchRequest = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
};
const completion = {
  attempt: 1,
  certification: "standards_review",
  changedPaths: ["src/task.ts", "src/task.test.ts"],
  completedAt: "2026-08-22T12:00:00.000Z",
  resultCommit: "result-commit",
  runId: request.runId,
  session,
  startCommit: "start-commit",
  task: task.identity,
  type: "task_completed",
  verification: { command: "pnpm check", exitCode: 0, output: "all green" },
} satisfies Extract<RunJournalEvent, { type: "task_completed" }>;

async function appendAttempt(journal: FileRunJournal): Promise<void> {
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: {
      dirtyPaths: [],
      head: completion.startCommit,
      root: "/repo",
      trackedPatch: "",
      untrackedHashes: {},
    },
    runId: request.runId,
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: task.instructions, skills: [] },
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  await appendPassedStandardsReview(journal, completion);
}

describe("plan projections", () => {
  it("generates task state and a human log from completion events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-projections-"));
    const journal = new FileRunJournal(root);
    await appendAttempt(journal);
    await journal.append(completion);
    const planRoot = path.join(root, "plans/plan-1");

    expect(
      JSON.parse(
        await readFile(path.join(planRoot, "task-state.json"), "utf8"),
      ),
    ).toEqual({
      completedTasks: [
        {
          attempt: 1,
          changedPaths: ["src/task.ts", "src/task.test.ts"],
          completedAt: "2026-08-22T12:00:00.000Z",
          resultCommit: "result-commit",
          runId: "run-1",
          session,
          startCommit: "start-commit",
          task: task.identity,
          verification: {
            command: "pnpm check",
            exitCode: 0,
            output: "all green",
          },
        },
      ],
      planId: "plan-1",
      schema: "striker.plan-task-state.v1",
    });
    const log = await readFile(path.join(planRoot, "log.md"), "utf8");
    expect(log).toContain("## Build task state");
    expect(log).toContain("`start-commit` -> `result-commit`");
    expect(log).toContain("- `src/task.ts`");
    expect(log).toContain("`pnpm check` exited 0");
  });

  it("recovers projections after the completion event is durable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-recovery-"));
    const journal = new FileRunJournal(root);
    await appendAttempt(journal);
    const planRoot = path.join(root, "plans/plan-1");
    await unlink(path.join(planRoot, "log.md"));
    await mkdir(path.join(planRoot, "log.md"));

    await expect(journal.append(completion)).rejects.toThrow();
    expect(
      await readFile(path.join(planRoot, "events.ndjson"), "utf8"),
    ).toContain('"type":"task_completed"');

    await rmdir(path.join(planRoot, "log.md"));
    await expect(journal.load("plan-1")).resolves.toMatchObject({
      completedTasks: [task.identity],
    });
    expect(await readFile(path.join(planRoot, "log.md"), "utf8")).toContain(
      "## Build task state",
    );
    expect(
      (await readFile(path.join(planRoot, "events.ndjson"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(8);
  });

  it("replaces a stale log before a query reads it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-query-repair-"));
    const journal = new FileRunJournal(root);
    await appendAttempt(journal);
    await journal.append(completion);
    const logPath = path.join(root, "plans/plan-1/log.md");
    await writeFile(logPath, "stale\n");

    await journal.load("plan-1");

    await expect(new FilePlanLogReader(root).read("plan-1")).resolves.toContain(
      "## Build task state",
    );
  });
});
