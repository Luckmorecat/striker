import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { FileRunJournal } from "./file-run-journal.js";

it("rejects retained task state after a completed event prefix", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-complete-prefix-"));
  const journal = new FileRunJournal(root);
  const identity = { id: "tasks/01.md", revision: "revision-1" };
  const session = { id: "runtime-session" };
  await journal.append({ runId: "run-1", type: "run_started" });
  await journal.append({
    attempt: 1,
    runId: "run-1",
    session,
    task: identity,
    type: "task_session_started",
  });
  await journal.append({
    runId: "run-1",
    session,
    task: identity,
    type: "task_completed",
  });
  await journal.replace({
    attempt: 1,
    runId: "run-1",
    session,
    status: "running",
    task: { identity, instructions: "Build.", title: "Build" },
  });

  await expect(journal.load("run-1")).rejects.toThrow(
    "Striker run snapshot retains a completed task",
  );
});
