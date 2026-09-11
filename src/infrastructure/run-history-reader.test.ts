import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DispatchRequest, ImplementationTask } from "../core/contracts.js";
import { FileRunJournal } from "./file-run-journal.js";
import { FileRunHistoryReader } from "./run-history-reader.js";

const identity = { id: "01", revision: "revision-1" };
const task: ImplementationTask = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity,
  instructions: "Build.",
  title: "Build",
};

function request(planId = "plan-1", runId = "run-1"): DispatchRequest {
  return {
    completedTasks: [],
    planId,
    runId,
    skills: [],
    taskSource: { location: "/repo/plan", type: "striker-plan" },
  };
}

async function stateRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "striker-history-"));
}

async function pausedRun(root: string): Promise<FileRunJournal> {
  const journal = new FileRunJournal(root);
  const value = request();
  await journal.append({
    planId: value.planId,
    request: value,
    runId: value.runId,
    type: "run_started",
  });
  await journal.append({ runId: value.runId, task, type: "task_selected" });
  await journal.append({
    before: null,
    runId: value.runId,
    task: identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: value.runId,
    task: identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: "go", skills: [] },
    runId: value.runId,
    session: { id: "session-1" },
    task: identity,
    type: "task_session_started",
  });
  await journal.append({
    attention: {
      detail: "Answer the open question.",
      reason: "assumption_needs_decision",
    },
    runId: value.runId,
    session: { id: "session-1" },
    task: identity,
    type: "run_needs_attention",
  });
  return journal;
}

describe("FileRunHistoryReader", () => {
  it("replays the active run's validated events in order", async () => {
    const root = await stateRoot();
    await pausedRun(root);

    const history = await new FileRunHistoryReader(
      new FileRunJournal(root),
    ).readActive();

    expect(history?.runId).toBe("run-1");
    expect(history?.planId).toBe("plan-1");
    expect(history?.events.map((event) => event.type)).toEqual([
      "run_started",
      "task_selected",
      "task_baseline_recorded",
      "task_attempt_started",
      "task_session_started",
      "run_needs_attention",
    ]);
  });

  it("reports no history when no run is active", async () => {
    const root = await stateRoot();

    await expect(
      new FileRunHistoryReader(new FileRunJournal(root)).readActive(),
    ).resolves.toBeNull();
  });

  it("rejects a journal the existing replay authority refuses", async () => {
    const root = await stateRoot();
    await pausedRun(root);
    const events = path.join(root, "plans", "plan-1", "events.ndjson");
    await writeFile(events, "{ not json }\n", { flag: "a" });

    await expect(
      new FileRunHistoryReader(new FileRunJournal(root)).readActive(),
    ).rejects.toThrow("Invalid Striker plan journal event");
  });

  it("excludes events belonging to other runs of the same plan", async () => {
    const root = await stateRoot();
    const journal = await pausedRun(root);
    await journal.append({ runId: "run-1", type: "run_discarded" });
    const second = request("plan-1", "run-2");
    await journal.append({
      planId: second.planId,
      request: second,
      runId: second.runId,
      type: "run_started",
    });

    const history = await new FileRunHistoryReader(
      new FileRunJournal(root),
    ).readActive();

    expect(history?.runId).toBe("run-2");
    expect(history?.events.map((event) => event.type)).toEqual(["run_started"]);
  });
});
