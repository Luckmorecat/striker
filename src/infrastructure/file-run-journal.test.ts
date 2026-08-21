import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RunOperations } from "../core/run-operations.js";
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
});

describe("file run journal completed-task recovery", () => {
  it("recovers completed task identities from durable events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-read-"));
    const journal = new FileRunJournal(root);
    const task = { id: "tasks/01.md", revision: "revision-1" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      runId: "run-1",
      session: { id: "session-1" },
      status: "running",
      task: {
        identity: task,
        instructions: "Build.",
        title: "Build",
      },
    });
    await journal.append({
      runId: "run-1",
      session: { id: "session-1" },
      task,
      type: "task_completed",
    });

    await expect(journal.load("missing")).resolves.toBeNull();
    await expect(journal.load("run-1")).resolves.toMatchObject({
      completedTasks: [task],
      lastEvent: {
        runId: "run-1",
        session: { id: "session-1" },
        task,
        type: "task_completed",
      },
      snapshot: { session: null, status: "running", task: null },
    });
  });
});

describe("file run journal validation and replay", () => {
  it("replays a fully appended attention event and repairs the stale snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-replay-"));
    const journal = new FileRunJournal(root);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Build the task.",
      title: "Build the task",
    };
    const session = { id: "runtime-key", resumeId: "provider-session" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      attempt: 1,
      runId: "run-1",
      session,
      status: "running",
      task,
    });
    await journal.append({
      attention: {
        detail: "Verification failed.",
        reason: "verification_failed",
      },
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_needs_attention",
    });

    await expect(journal.loadActive()).resolves.toMatchObject({
      lastEvent: { type: "run_needs_attention" },
      snapshot: {
        attention: { reason: "verification_failed" },
        status: "needs_attention",
      },
    });
    expect(
      await readFile(path.join(root, "runs/run-1/snapshot.json"), "utf8"),
    ).toContain('"eventCount": 2');
  });
});

describe("file run journal version and corruption checks", () => {
  it("rejects unknown event versions without rewriting journal files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-version-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });
    const eventsPath = path.join(root, "runs/run-1/events.ndjson");
    const unsupported = `${JSON.stringify({
      event: { runId: "run-1", type: "run_started" },
      schema: "striker.run.v2",
    })}\n`;
    await writeFile(eventsPath, unsupported);

    await expect(journal.load("run-1")).rejects.toThrow(
      "Unsupported Striker run journal schema: striker.run.v2",
    );
    expect(await readFile(eventsPath, "utf8")).toBe(unsupported);
  });

  it("rejects unknown snapshot versions without rewriting the snapshot", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "striker-journal-snapshot-version-"),
    );
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      runId: "run-1",
      session: null,
      status: "running",
      task: null,
    });
    const snapshotPath = path.join(root, "runs/run-1/snapshot.json");
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<
      string,
      unknown
    >;
    parsed.schema = "striker.run.v2";
    const unsupported = `${JSON.stringify(parsed)}\n`;
    await writeFile(snapshotPath, unsupported);

    await expect(journal.load("run-1")).rejects.toThrow(
      "Unsupported Striker run journal schema: striker.run.v2",
    );
    expect(await readFile(snapshotPath, "utf8")).toBe(unsupported);
  });

  it("rejects corrupt and contradictory state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-invalid-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      runId: "run-1",
      session: null,
      status: "running",
      task: null,
    });
    const snapshotPath = path.join(root, "runs/run-1/snapshot.json");
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<
      string,
      unknown
    >;
    parsed.eventCount = 2;
    await writeFile(snapshotPath, `${JSON.stringify(parsed)}\n`);

    await expect(journal.load("run-1")).rejects.toThrow(
      "Striker run snapshot is ahead of its event journal",
    );

    await writeFile(path.join(root, "runs/run-1/events.ndjson"), "not-json\n");
    await expect(journal.load("run-1")).rejects.toThrow(
      "Invalid Striker run journal event",
    );
  });
});

describe("file run journal contradiction checks", () => {
  it("rejects an invalid durable event order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-order-"));
    const journal = new FileRunJournal(root);
    const task = { id: "tasks/01.md", revision: "revision-1" };
    const session = { id: "runtime-session" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      error: "failed",
      runId: "run-1",
      session,
      task,
      type: "run_failed",
    });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      session,
      task,
      type: "task_session_started",
    });

    await expect(journal.load("run-1")).rejects.toThrow(
      "Striker session event has an invalid attempt",
    );
  });

  it("rejects a snapshot that contradicts its applied event prefix", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-prefix-state-"));
    const journal = new FileRunJournal(root);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Build.",
      title: "Build",
    };
    const session = { id: "runtime-session" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      attention: { detail: "failed", reason: "verification_failed" },
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    await journal.replace({
      attention: null,
      runId: "run-1",
      session,
      status: "running",
      task,
    });

    await expect(journal.load("run-1")).rejects.toThrow(
      "Striker run snapshot contradicts its event status",
    );
  });

  it("rejects a provider session change inside one attempt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-session-change-"));
    const journal = new FileRunJournal(root);
    const task = { id: "tasks/01.md", revision: "revision-1" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      session: { id: "runtime-a", resumeId: "provider-a" },
      task,
      type: "task_session_started",
    });
    await journal.append({
      attention: { detail: "failed", reason: "verification_failed" },
      runId: "run-1",
      session: { id: "runtime-b", resumeId: "provider-b" },
      task,
      type: "run_needs_attention",
    });

    await expect(journal.load("run-1")).rejects.toThrow(
      "Striker run event changes the active session",
    );
  });
});

describe("file run journal initialization recovery", () => {
  it("turns an interrupted run claim into discardable failed state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-orphan-run-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });

    await expect(journal.loadActive()).resolves.toMatchObject({
      snapshot: {
        attention: { reason: "run_initialization_interrupted" },
        runId: "run-1",
        status: "failed",
      },
    });
    await new RunOperations(journal).discard();
    await expect(journal.loadActive()).resolves.toBeNull();
  });

  it("recovers a source conflict appended before the first snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-orphan-source-"));
    const journal = new FileRunJournal(root);
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      current: null,
      runId: "run-1",
      task: { id: "tasks/01.md", revision: "removed" },
      type: "run_source_changed",
    });

    await expect(journal.loadActive()).resolves.toMatchObject({
      snapshot: { session: null, status: "needs_attention", task: null },
    });
    await new RunOperations(journal).discard();
    await expect(journal.loadActive()).resolves.toBeNull();
  });
});

describe("file run journal legacy snapshot recovery", () => {
  it("infers the applied prefix for a stale v1 snapshot without a cursor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-legacy-snapshot-"));
    const journal = new FileRunJournal(root);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Build.",
      title: "Build",
    };
    const session = { id: "runtime-session", resumeId: "provider-session" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.replace({
      attempt: 1,
      runId: "run-1",
      session,
      status: "running",
      task,
    });
    const snapshotPath = path.join(root, "runs/run-1/snapshot.json");
    const legacy = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete legacy.eventCount;
    await writeFile(snapshotPath, `${JSON.stringify(legacy)}\n`);
    await journal.append({
      attention: { detail: "failed", reason: "verification_failed" },
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_needs_attention",
    });

    await expect(journal.loadActive()).resolves.toMatchObject({
      snapshot: {
        attention: { reason: "verification_failed" },
        status: "needs_attention",
      },
    });
  });
});

describe("file run journal task attempt reset", () => {
  it("starts the next task at attempt one after a retried task completes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-attempt-reset-"));
    const journal = new FileRunJournal(root);
    const first = { id: "tasks/01.md", revision: "revision-1" };
    const second = { id: "tasks/02.md", revision: "revision-2" };
    const firstSession = { id: "runtime-1" };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      session: firstSession,
      task: first,
      type: "task_session_started",
    });
    await journal.append({
      error: "failed",
      runId: "run-1",
      session: firstSession,
      task: first,
      type: "run_failed",
    });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      task: first,
      type: "run_retried",
    });
    const retrySession = { id: "runtime-2" };
    await journal.append({
      attempt: 2,
      runId: "run-1",
      session: retrySession,
      task: first,
      type: "task_session_started",
    });
    await journal.append({
      runId: "run-1",
      session: retrySession,
      task: first,
      type: "task_completed",
    });
    const secondSession = { id: "runtime-3" };
    await journal.append({
      attempt: 1,
      runId: "run-1",
      session: secondSession,
      task: second,
      type: "task_session_started",
    });
    await journal.replace({
      attempt: 1,
      runId: "run-1",
      session: secondSession,
      status: "running",
      task: { identity: second, instructions: "Build.", title: "Build" },
    });

    await expect(journal.load("run-1")).resolves.toMatchObject({
      snapshot: { attempt: 1, task: { identity: second } },
    });
  });
});

describe("file run journal recovery", () => {
  it("recovers the active paused session, reason, and developer answer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-pause-"));
    const journal = new FileRunJournal(root);
    const task = {
      identity: { id: "tasks/01.md", revision: "revision-1" },
      instructions: "Build the task.",
      title: "Build the task",
    };
    const session = { id: "runtime-key", resumeId: "agent-session" };
    const attention = {
      detail: "The verification command exited with code 1.\nfailed output",
      reason: "verification_failed" as const,
    };
    await journal.append({ runId: "run-1", type: "run_started" });
    await journal.append({
      attention,
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    await journal.append({
      answer: "Use the existing schema.",
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_answered",
    });
    await journal.append({
      attention,
      runId: "run-1",
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    await journal.replace({
      attention,
      before: null,
      request: {
        completedTasks: [],
        runId: "run-1",
        skills: [],
        taskSource: { location: "/repo/plan", type: "striker-plan" },
      },
      runId: "run-1",
      session,
      status: "needs_attention",
      task,
    });

    await expect(journal.loadActive()).resolves.toMatchObject({
      completedTasks: [],
      snapshot: {
        attention: { reason: "verification_failed" },
        session,
        status: "needs_attention",
      },
    });
    const eventsPath = path.join(root, "runs/run-1/events.ndjson");
    expect(await readFile(eventsPath, "utf8")).toContain(
      "Use the existing schema.",
    );
    expect((await stat(eventsPath)).mode & 0o777).toBe(0o600);
  });
});
