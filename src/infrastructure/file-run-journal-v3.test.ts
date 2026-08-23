import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { FileRunJournal } from "./file-run-journal.js";
import { standardsRunJournalSchemaId } from "./run-journal-schema.js";

const identity = { id: "tasks/01.md", revision: "revision-1" };
const session = { id: "session-1" };
const request = {
  completedTasks: [],
  planId: "plan-1",
  runId: "run-1",
  skills: [],
  taskSource: { location: "/repo/plan", type: "striker-plan" },
};
const task = {
  identity,
  instructions: "Build.",
  title: "Build",
};

function version3Events() {
  return [
    { planId: "plan-1", request, runId: "run-1", type: "run_started" },
    { runId: "run-1", task, type: "task_selected" },
    {
      before: null,
      runId: "run-1",
      task: identity,
      type: "task_baseline_recorded",
    },
    {
      attempt: 1,
      runId: "run-1",
      task: identity,
      type: "task_attempt_started",
    },
    {
      attempt: 1,
      runId: "run-1",
      session,
      task: identity,
      type: "task_session_started",
    },
    {
      attention: {
        detail: "The implementor omitted its review marker.",
        reason: "review_evidence_missing",
      },
      runId: "run-1",
      session,
      task: identity,
      type: "run_needs_attention",
    },
  ];
}

it("loads version 3 attention from the retired review marker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-journal-v3-"));
  const planRoot = path.join(root, "plans/plan-1");
  await mkdir(planRoot, { recursive: true });
  const history = version3Events()
    .map((event) =>
      JSON.stringify({ event, schema: standardsRunJournalSchemaId }),
    )
    .join("\n");
  await writeFile(path.join(planRoot, "events.ndjson"), `${history}\n`);

  await expect(new FileRunJournal(root).load("plan-1")).resolves.toMatchObject({
    snapshot: {
      attention: { reason: "review_evidence_missing" },
      status: "needs_attention",
    },
  });
});
