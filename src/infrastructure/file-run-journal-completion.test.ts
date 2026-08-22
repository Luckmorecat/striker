import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { appendPassedStandardsReview } from "../testing/fakes.js";
import { FileRunJournal } from "./file-run-journal.js";
import { legacyRunJournalSchemaId } from "./run-journal-schema.js";

const identity = { id: "tasks/01.md", revision: "revision-1" };
const task = {
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
const request = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
} as const;

async function appendCompletedRun(journal: FileRunJournal): Promise<void> {
  const session = { id: "runtime-session" };
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
      head: "before",
      root: "/repo",
      trackedPatch: "",
      untrackedHashes: {},
    },
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
  await appendPassedStandardsReview(journal, {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    resultCommit: "after",
    runId: request.runId,
    startCommit: "before",
    task: identity,
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  await journal.append({
    attempt: 1,
    certification: "standards_review",
    changedPaths: ["src/task.ts"],
    completedAt: "2026-08-22T12:00:00.000Z",
    resultCommit: "after",
    runId: request.runId,
    session,
    startCommit: "before",
    task: identity,
    type: "task_completed",
    verification: { command: "pnpm check", exitCode: 0, output: "ok" },
  });
  await journal.append({ runId: request.runId, type: "run_completed" });
}

function legacyHistory(content: string): string {
  const lines = content.trim().split("\n");
  const envelopes = lines.map(
    (line) =>
      JSON.parse(line) as {
        event: Record<string, unknown>;
        schema: string;
      },
  );
  return `${envelopes
    .filter(({ event }) => !String(event.type).startsWith("standards_"))
    .map(({ event }) => {
      Reflect.deleteProperty(event, "certification");
      return JSON.stringify({ event, schema: legacyRunJournalSchemaId });
    })
    .join("\n")}\n`;
}

function legacySnapshot(content: string, eventCount: number): string {
  const envelope = JSON.parse(content) as {
    eventCount: number;
    schema: string;
    snapshot: Record<string, unknown>;
  };
  Reflect.deleteProperty(envelope.snapshot, "standardsReview");
  return `${JSON.stringify({ ...envelope, eventCount, schema: legacyRunJournalSchemaId })}\n`;
}

it("retains completed plan history and rebuilds a missing projection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-history-"));
  const journal = new FileRunJournal(root);
  await appendCompletedRun(journal);

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

it("loads completed history from the prior journal schema", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-legacy-"));
  const journal = new FileRunJournal(root);
  await appendCompletedRun(journal);
  const planRoot = path.join(root, "plans/plan-1");
  const eventsPath = path.join(planRoot, "events.ndjson");
  const history = legacyHistory(await readFile(eventsPath, "utf8"));
  await writeFile(eventsPath, history);
  const snapshotPath = path.join(planRoot, "snapshot.json");
  await writeFile(
    snapshotPath,
    legacySnapshot(
      await readFile(snapshotPath, "utf8"),
      history.trim().split("\n").length,
    ),
  );

  await expect(journal.load("plan-1")).resolves.toMatchObject({
    completedTasks: [identity],
    snapshot: { status: "completed" },
  });
});
