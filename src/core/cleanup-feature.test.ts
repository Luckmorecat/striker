import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { CleanupFeature } from "./cleanup-feature.js";

it("records recoverable cleanup intent and refuses running features", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cleanup-"));
  try {
    const journal = new FileRunJournal(root);
    const request = {
      runId: "cleanup",
      planId: "plan",
      completedTasks: [],
      skills: [],
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
      runId: request.runId,
      planId: request.planId,
      request,
    });
    let fail = true;
    const resources = {
      remove: async () => {
        expect((await journal.loadRun("cleanup"))?.cleanup).toBe("started");
        if (fail) throw new Error("Docker unavailable");
      },
    };
    const cleanup = new CleanupFeature(journal, resources);
    await expect(cleanup.cleanup("cleanup")).rejects.toThrow(/running/);
    await journal.append({ type: "run_completed", runId: "cleanup" });
    await expect(cleanup.cleanup("cleanup")).rejects.toThrow(
      /Docker unavailable/,
    );
    expect((await journal.loadRun("cleanup"))?.cleanup).toBe("started");
    fail = false;
    await cleanup.cleanup("cleanup");
    await cleanup.cleanup("cleanup");
    expect((await journal.loadRun("cleanup"))?.cleanup).toBe("completed");
    expect((await journal.loadRun("cleanup"))?.status).toBe("completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
