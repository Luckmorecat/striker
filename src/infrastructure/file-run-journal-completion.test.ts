import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { FileRunJournal } from "./file-run-journal.js";

it("retains completed plan history and rebuilds a missing projection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-history-"));
  const journal = new FileRunJournal(root);
  const identity = { id: "tasks/01.md", revision: "revision-1" };
  const task = { identity, instructions: "Build.", title: "Build" };
  const request = {
    completedTasks: [],
    planId: "plan-1",
    runId: "run-1",
    skills: [],
    taskSource: { location: "/repo/plan", type: "striker-plan" },
  } as const;
  const session = { id: "runtime-session" };

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
    task: identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    session,
    task: identity,
    type: "task_session_started",
  });
  await journal.append({
    runId: request.runId,
    session,
    task: identity,
    type: "task_completed",
  });
  await journal.append({ runId: request.runId, type: "run_completed" });

  const planRoot = path.join(root, "plans/plan-1");
  await unlink(path.join(planRoot, "snapshot.json"));

  await expect(journal.load("plan-1")).resolves.toMatchObject({
    completedTasks: [identity],
    lastEvent: { runId: "run-1", type: "run_completed" },
    snapshot: { runId: "run-1", status: "completed", task: null },
  });
  await expect(journal.loadActive()).resolves.toBeNull();
  expect(
    await readFile(path.join(planRoot, "events.ndjson"), "utf8"),
  ).toContain('"type":"task_completed"');
});
