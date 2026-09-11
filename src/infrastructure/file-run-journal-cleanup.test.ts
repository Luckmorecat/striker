import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CleanupFeature } from "../core/cleanup-feature.js";
import { RunOperations } from "../core/run-operations.js";
import { validateRecovery } from "../core/recovery-policy.js";
import { FileRunJournal } from "./file-run-journal.js";

async function paused(root: string) {
  const journal = new FileRunJournal(root);
  const request = {
    runId: "cleanup",
    planId: "plan",
    skills: [],
    completedTasks: [],
    taskSource: { type: "memory", location: "plan" },
    execution: {
      backend: "docker" as const,
      recoveryId: "c".repeat(64),
      environmentId: "d".repeat(64),
      imageId: `sha256:${"e".repeat(64)}`,
      sourceRoot: "/repo",
      sourceHead: "a".repeat(40),
      sourceBranch: "main",
    },
  };
  await journal.append({
    type: "run_started",
    runId: "cleanup",
    planId: "plan",
    request,
  });
  await journal.append({
    type: "run_source_changed",
    runId: "cleanup",
    task: { id: "removed", revision: "v1" },
    current: null,
  });
  return journal;
}

it("reopens cleanup after lost completion, blocks continuation and still permits discard", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cleanup-journal-"));
  try {
    const journal = await paused(root);
    const command = new CleanupFeature(
      {
        loadRun: (id) => journal.loadRun(id),
        append: (event) => {
          if (event.type === "cleanup_completed")
            throw new Error("lost completion");
          return journal.append(event);
        },
      },
      { remove: () => Promise.resolve() },
    );
    await expect(command.cleanup("cleanup")).rejects.toThrow(/lost completion/);
    const reopened = new FileRunJournal(root);
    const active = await reopened.loadActive();
    if (!active) throw new Error("Missing active journal");
    for (const action of ["resume", "retry", "answer"] as const)
      expect(() => {
        validateRecovery(active, action);
      }).toThrow(/cleaned up/);
    await new CleanupFeature(reopened, {
      remove: () => Promise.resolve(),
    }).cleanup("cleanup");
    expect((await reopened.loadRun("cleanup"))?.cleanup).toBe("completed");
    await new RunOperations(reopened, {
      stop: () => Promise.resolve(),
    }).discard();
    expect(await reopened.loadActive()).toBeNull();
    expect((await reopened.loadRun("cleanup"))?.status).toBe("discarded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not record discard when isolated quiescence fails or lacks a stopper", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-discard-stop-"));
  try {
    const journal = await paused(root);
    await expect(new RunOperations(journal).discard()).rejects.toThrow(
      /stopper/,
    );
    await expect(
      new RunOperations(journal, {
        stop: () => Promise.reject(new Error("cannot stop")),
      }).discard(),
    ).rejects.toThrow(/cannot stop/);
    expect((await journal.loadActive())?.snapshot?.status).toBe(
      "needs_attention",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects pre-cleanup journal schemas without changing old data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cleanup-schema-"));
  try {
    await paused(root);
    const file = path.join(root, "plans/plan/events.ndjson");
    const old = (await readFile(file, "utf8")).replaceAll(
      "striker.plan-journal.v11",
      "striker.plan-journal.v10",
    );
    await writeFile(file, old);
    await expect(new FileRunJournal(root).loadRun("cleanup")).rejects.toThrow(
      /Unsupported/,
    );
    expect(await readFile(file, "utf8")).toBe(old);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
