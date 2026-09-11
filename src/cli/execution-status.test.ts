import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { readExecutionStatus } from "./execution-status.js";

it("keeps journal-backed status and restoration guidance when recovery metadata is missing or invalid", async () => {
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "striker-missing-status-"),
  );
  const journal = new FileRunJournal(stateRoot);
  const imageId = `sha256:${"a".repeat(64)}`;
  const artifacts = path.join(stateRoot, "environments", "missing");
  try {
    await journal.append({
      type: "run_started",
      runId: "missing",
      planId: "plan",
      request: {
        runId: "missing",
        planId: "plan",
        completedTasks: [],
        skills: [],
        taskSource: { type: "striker-plan", location: "/plan" },
        execution: {
          backend: "docker",
          imageId,
          environmentId: "b".repeat(64),
          recoveryId: "c".repeat(64),
          sourceHead: "d".repeat(40),
          sourceBranch: "main",
          sourceRoot: "/source",
        },
      },
    });
    for (const contents of [undefined, "sensitive-invalid-record"]) {
      if (contents) {
        await mkdir(artifacts, { recursive: true });
        await writeFile(path.join(artifacts, "recovery.json"), contents);
      }
      const status = await readExecutionStatus(stateRoot);
      expect(status).toMatchObject({
        runId: "missing",
        status: "running",
        recoveryActions: [],
        execution: { backend: "docker", imageId, artifacts },
      });
      expect(status?.execution?.error).toContain("Restore");
      expect(status?.execution?.error).toContain("recovery.json");
      expect(JSON.stringify(status)).not.toContain("sensitive-invalid-record");
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
