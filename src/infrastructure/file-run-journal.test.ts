import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileRunJournal } from "./file-run-journal.js";

describe("file run journal", () => {
  it("writes versioned private events before atomic snapshots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      runId: "run-1",
      session: null,
      status: "running",
      task: null,
    });
    const runRoot = path.join(root, "runs/run-1");

    expect(
      await readFile(path.join(runRoot, "events.ndjson"), "utf8"),
    ).toContain('"schema":"striker.run.v1"');
    expect(
      await readFile(path.join(runRoot, "snapshot.json"), "utf8"),
    ).toContain('"status": "running"');
    expect((await stat(runRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(runRoot, "snapshot.json"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("allows only one active run and deletes successful state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-guard-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });

    await expect(
      journal.append({ runId: "run-2", type: "run_started" }),
    ).rejects.toThrow("Another Striker run is active: run-1");

    await journal.delete("run-1");
    await expect(
      journal.append({ runId: "run-2", type: "run_started" }),
    ).resolves.toBeUndefined();
  });

  it("claims the active run atomically across concurrent starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-race-"));
    const results = await Promise.allSettled([
      new FileRunJournal(root).append({ runId: "run-a", type: "run_started" }),
      new FileRunJournal(root).append({ runId: "run-b", type: "run_started" }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("recovers completed task identities from durable events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-read-"));
    const journal = new FileRunJournal(root);
    const task = { id: "tasks/01.md", revision: "revision-1" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      runId: "run-1",
      session: { id: "session-1" },
      task,
      type: "task_completed",
    });

    await expect(journal.load("missing")).resolves.toBeNull();
    await expect(journal.load("run-1")).resolves.toEqual({
      completedTasks: [task],
    });
  });
});
