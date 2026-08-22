import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  DispatchRequest,
  ImplementationTask,
  RunJournalEvent,
} from "../core/contracts.js";
import { FileRunJournal } from "./file-run-journal.js";
import { runJournalSchemaId } from "./run-journal-schema.js";

const identity = { id: "tasks/01.md", revision: "revision-1" };
const task: ImplementationTask = {
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

async function start(
  journal: FileRunJournal,
  value = request(),
): Promise<void> {
  await journal.append({
    planId: value.planId,
    request: value,
    runId: value.runId,
    type: "run_started",
  });
}

async function startAttempt(
  journal: FileRunJournal,
  value = request(),
  session = { id: "session-1" },
): Promise<void> {
  await start(journal, value);
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
    runId: value.runId,
    session,
    task: identity,
    type: "task_session_started",
  });
}

describe("file plan journal storage", () => {
  it("writes versioned private events and an atomic projection by plan id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-"));
    const journal = new FileRunJournal(root);
    await start(journal);
    const planRoot = path.join(root, "plans/plan-1");

    expect(
      await readFile(path.join(planRoot, "events.ndjson"), "utf8"),
    ).toContain(`"schema":"${runJournalSchemaId}"`);
    expect(
      await readFile(path.join(planRoot, "snapshot.json"), "utf8"),
    ).toContain('"planId": "plan-1"');
    expect((await stat(planRoot)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(path.join(planRoot, "snapshot.json"))).mode & 0o777,
    ).toBe(0o600);
  });

  it("allows one active run and releases only its claim at completion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-guard-"));
    const journal = new FileRunJournal(root);
    await start(journal);

    await expect(start(journal, request("plan-2", "run-2"))).rejects.toThrow(
      "Another Striker run is active: run-1",
    );
    await journal.append({ runId: "run-1", type: "run_completed" });
    await expect(
      start(journal, request("plan-2", "run-2")),
    ).resolves.toBeUndefined();
    await expect(journal.load("plan-1")).resolves.toMatchObject({
      lastEvent: { type: "run_completed" },
    });
  });

  it("claims concurrent starts atomically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-race-"));
    const results = await Promise.allSettled([
      start(new FileRunJournal(root), request("plan-a", "run-a")),
      start(new FileRunJournal(root), request("plan-b", "run-b")),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("releases an orphaned claim left before the start event", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-orphan-"));
    const journal = new FileRunJournal(root);
    await writeFile(
      path.join(root, "active-run.json"),
      `${JSON.stringify({ ownerPid: 2_000_000_000, planId: "orphan", runId: "orphan" })}\n`,
    );

    await expect(journal.loadActive()).resolves.toBeNull();
    await expect(start(journal)).resolves.toBeUndefined();
  });
});

describe("file plan journal validation and replay", () => {
  it("repairs a projection that trails an authoritative append", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-replay-"));
    const journal = new FileRunJournal(root);
    const session = { id: "session-1" };
    await startAttempt(journal, request(), session);
    const planRoot = path.join(root, "plans/plan-1");
    const eventsPath = path.join(planRoot, "events.ndjson");
    const event: RunJournalEvent = {
      attention: {
        detail: "Verification failed.",
        reason: "verification_failed",
      },
      runId: "run-1",
      session,
      task: identity,
      type: "run_needs_attention",
    };
    await writeFile(
      eventsPath,
      `${await readFile(eventsPath, "utf8")}${JSON.stringify({ event, schema: runJournalSchemaId })}\n`,
    );

    await expect(journal.append(event)).resolves.toBeUndefined();
    await expect(journal.loadActive()).resolves.toMatchObject({
      lastEvent: { type: "run_needs_attention" },
      snapshot: {
        attention: { reason: "verification_failed" },
        status: "needs_attention",
      },
    });
    expect(
      await readFile(path.join(planRoot, "snapshot.json"), "utf8"),
    ).toContain('"eventCount": 6');
    expect(
      (await readFile(eventsPath, "utf8")).trim().split("\n"),
    ).toHaveLength(6);
  });

  it("rejects unknown schema versions without rewriting events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-version-"));
    const journal = new FileRunJournal(root);
    await start(journal);
    const eventsPath = path.join(root, "plans/plan-1/events.ndjson");
    const unsupported = `${JSON.stringify({ event: { runId: "run-1", type: "run_completed" }, schema: "striker.plan-journal.v3" })}\n`;
    await writeFile(eventsPath, unsupported);

    await expect(journal.load("plan-1")).rejects.toThrow(
      "Unsupported Striker plan journal schema: striker.plan-journal.v3",
    );
    expect(await readFile(eventsPath, "utf8")).toBe(unsupported);
  });

  it("rejects an event before writing when its ordering is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-order-"));
    const journal = new FileRunJournal(root);
    await start(journal);

    await expect(
      journal.append({
        attempt: 1,
        runId: "run-1",
        session: { id: "session-1" },
        task: identity,
        type: "task_session_started",
      }),
    ).rejects.toThrow("selected task");
    expect(
      await readFile(path.join(root, "plans/plan-1/events.ndjson"), "utf8"),
    ).not.toContain("task_session_started");
  });
});

describe("file plan journal event ordering", () => {
  it("requires a baseline event before starting an attempt", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "striker-journal-baseline-"),
    );
    const journal = new FileRunJournal(root);
    await start(journal);
    await journal.append({ runId: "run-1", task, type: "task_selected" });

    await expect(
      journal.append({
        attempt: 1,
        runId: "run-1",
        task: identity,
        type: "task_attempt_started",
      }),
    ).rejects.toThrow("baseline");
  });

  it("rejects a session start while the run needs attention", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-paused-"));
    const journal = new FileRunJournal(root);
    await start(journal);
    await journal.append({ runId: "run-1", task, type: "task_selected" });
    await journal.append({
      before: null,
      runId: "run-1",
      task: identity,
      type: "task_baseline_recorded",
    });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      task: identity,
      type: "task_attempt_started",
    });
    await journal.append({
      attention: {
        detail: "Session setup stopped.",
        reason: "run_initialization_interrupted",
      },
      runId: "run-1",
      session: null,
      task: identity,
      type: "run_needs_attention",
    });

    await expect(
      journal.append({
        attempt: 1,
        runId: "run-1",
        session: { id: "late-session" },
        task: identity,
        type: "task_session_started",
      }),
    ).rejects.toThrow("invalid attempt");
  });
});

describe("file plan journal transition validation", () => {
  it("normalizes task events before detecting an append retry", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "striker-journal-normalize-"),
    );
    const journal = new FileRunJournal(root);
    const selected = {
      runId: "run-1",
      task: {
        ...task,
        affectedPaths: ["src/task.ts"],
        path: "tasks/01.md",
        verifyCommand: "pnpm check",
      },
      type: "task_selected" as const,
    };
    await start(journal);
    await journal.append(selected);

    await expect(journal.append(selected)).resolves.toBeUndefined();
    expect(
      (await readFile(path.join(root, "plans/plan-1/events.ndjson"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(2);
  });

  it("rejects task completion after the run has failed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-failed-"));
    const journal = new FileRunJournal(root);
    const session = { id: "session-1" };
    await startAttempt(journal, request(), session);
    await journal.append({
      error: "failed",
      runId: "run-1",
      session,
      task: identity,
      type: "run_failed",
    });

    await expect(
      journal.append({
        attempt: 1,
        changedPaths: ["src/task.ts"],
        completedAt: "2026-08-22T12:00:00.000Z",
        resultCommit: "after",
        runId: "run-1",
        session,
        startCommit: "before",
        task: identity,
        type: "task_completed",
        verification: { command: "pnpm check", exitCode: 0, output: "ok" },
      }),
    ).rejects.toThrow("Illegal run transition: failed -> complete_task");
  });

  it("rejects a projection ahead of the journal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-ahead-"));
    const journal = new FileRunJournal(root);
    await start(journal);
    const snapshotPath = path.join(root, "plans/plan-1/snapshot.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      eventCount: number;
    };
    snapshot.eventCount = 2;
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`);

    await expect(journal.load("plan-1")).rejects.toThrow(
      "snapshot is ahead of its plan journal",
    );
  });
});

describe("file plan journal recovery", () => {
  it("replays completed identities captured by the run start", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-seed-"));
    const journal = new FileRunJournal(root);
    await start(journal, { ...request(), completedTasks: [identity] });

    await expect(journal.load("plan-1")).resolves.toMatchObject({
      completedTasks: [identity],
    });
  });

  it("rebuilds a paused session and developer continuation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-pause-"));
    const journal = new FileRunJournal(root);
    const session = { id: "session-1", resumeId: "provider-1" };
    const attention = {
      detail: "Verification failed.",
      reason: "verification_failed" as const,
    };
    await startAttempt(journal, request(), session);
    await journal.append({
      attention,
      runId: "run-1",
      session,
      task: identity,
      type: "run_needs_attention",
    });
    await journal.append({
      answer: "Use the schema.",
      runId: "run-1",
      session,
      task: identity,
      type: "run_answered",
    });
    await journal.append({
      attention,
      runId: "run-1",
      session,
      task: identity,
      type: "run_needs_attention",
    });

    await expect(journal.loadActive()).resolves.toMatchObject({
      completedTasks: [],
      snapshot: {
        attention: { reason: "verification_failed" },
        session,
        status: "needs_attention",
      },
    });
    expect(
      await readFile(path.join(root, "plans/plan-1/events.ndjson"), "utf8"),
    ).toContain("Use the schema.");
  });
});

describe("file plan journal retained history", () => {
  it("retains completed tasks across a discarded later run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-history-"));
    const journal = new FileRunJournal(root);
    const session = { id: "session-1" };
    await startAttempt(journal, request(), session);
    await journal.append({
      attempt: 1,
      changedPaths: ["src/task.ts"],
      completedAt: "2026-08-22T12:00:00.000Z",
      resultCommit: "after",
      runId: "run-1",
      session,
      startCommit: "before",
      task: identity,
      type: "task_completed",
      verification: { command: "pnpm check", exitCode: 0, output: "ok" },
    });
    await journal.append({ runId: "run-1", type: "run_completed" });
    await start(journal, request("plan-1", "run-2"));
    await journal.append({
      current: null,
      runId: "run-2",
      task: { id: "tasks/02.md", revision: "removed" },
      type: "run_source_changed",
    });
    await journal.append({ runId: "run-2", type: "run_discarded" });

    await expect(journal.load("plan-1")).resolves.toMatchObject({
      completedTasks: [identity],
      lastEvent: { runId: "run-2", type: "run_discarded" },
      snapshot: { status: "discarded" },
    });
  });
});

describe("file plan journal attempt replay", () => {
  it("resets the next task to attempt one after a retried task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-retry-"));
    const journal = new FileRunJournal(root);
    const firstSession = { id: "session-1" };
    await startAttempt(journal, request(), firstSession);
    await journal.append({
      error: "failed",
      runId: "run-1",
      session: firstSession,
      task: identity,
      type: "run_failed",
    });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      task: identity,
      type: "run_retried",
    });
    await journal.append({
      attempt: 2,
      runId: "run-1",
      task: identity,
      type: "task_attempt_started",
    });
    const retrySession = { id: "session-2" };
    await journal.append({
      attempt: 2,
      runId: "run-1",
      session: retrySession,
      task: identity,
      type: "task_session_started",
    });
    await journal.append({
      attempt: 2,
      changedPaths: ["src/task.ts"],
      completedAt: "2026-08-22T12:00:00.000Z",
      resultCommit: "after",
      runId: "run-1",
      session: retrySession,
      startCommit: "before",
      task: identity,
      type: "task_completed",
      verification: { command: "pnpm check", exitCode: 0, output: "ok" },
    });
    const second = {
      identity: { id: "tasks/02.md", revision: "revision-2" },
      instructions: "Continue.",
      title: "Continue",
    };
    await journal.append({
      runId: "run-1",
      task: second,
      type: "task_selected",
    });
    await journal.append({
      before: null,
      runId: "run-1",
      task: second.identity,
      type: "task_baseline_recorded",
    });
    await journal.append({
      attempt: 1,
      runId: "run-1",
      task: second.identity,
      type: "task_attempt_started",
    });

    const firstLoad = await journal.load("plan-1");
    const secondLoad = await journal.load("plan-1");
    expect(secondLoad).toEqual(firstLoad);
    expect(secondLoad).toMatchObject({
      completedTasks: [identity],
      snapshot: { attempt: 1, task: { identity: second.identity } },
    });
  });
});
