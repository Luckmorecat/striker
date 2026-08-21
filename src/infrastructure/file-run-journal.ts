import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type {
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
} from "../core/contracts.js";
import { transitionRun } from "../core/run-state.js";
import { replayEvent } from "./run-journal-replay.js";
import {
  assertEventSequence,
  assertSnapshotPrefix,
  inferSnapshotEventCount,
} from "./run-journal-sequence.js";
import {
  eventEnvelopeSchema,
  runJournalEventSchema,
  runJournalSchemaId,
  runSnapshotSchema,
  snapshotEnvelopeSchema,
} from "./run-journal-schema.js";

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseJson(content: string, message: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(message, { cause: error });
  }
}

function schemaValue(value: unknown): unknown {
  return typeof value === "object" && value !== null && "schema" in value
    ? value.schema
    : undefined;
}

function rejectUnsupportedSchema(value: unknown): void {
  const schema = schemaValue(value);
  if (schema !== undefined && schema !== runJournalSchemaId) {
    const label = typeof schema === "string" ? schema : JSON.stringify(schema);
    throw new Error(`Unsupported Striker run journal schema: ${label}`);
  }
}

function parseEvent(line: string): RunJournalEvent {
  const value = parseJson(line, "Invalid Striker run journal event");
  rejectUnsupportedSchema(value);
  const parsed = eventEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid Striker run journal event", {
      cause: parsed.error,
    });
  }
  return parsed.data.event as RunJournalEvent;
}

function recoverMissingSnapshot(
  events: readonly RunJournalEvent[],
  runId: string,
): RunSnapshot {
  if (events.length === 1 && events[0]?.type === "run_started") {
    return {
      attention: {
        detail:
          "The process stopped before Striker recorded the first task. Discard this run before starting another.",
        reason: "run_initialization_interrupted",
      },
      runId,
      session: null,
      status: "failed",
      task: null,
    };
  }
  if (
    events.length === 2 &&
    events[0]?.type === "run_started" &&
    events[1]?.type === "run_source_changed"
  ) {
    return {
      attention: null,
      runId,
      session: null,
      status: transitionRun("running", "request_attention"),
      task: null,
    };
  }
  throw new Error("Striker run journal events are missing their snapshot");
}

export class FileRunJournal implements RunJournal {
  readonly #runsRoot: string;

  constructor(stateRoot: string) {
    this.#runsRoot = path.join(stateRoot, "runs");
  }

  async append(event: RunJournalEvent): Promise<void> {
    runJournalEventSchema.parse(event);
    await ensurePrivateDirectory(this.#runsRoot);
    if (event.type === "run_started") await this.claimRun(event.runId);
    const runRoot = this.runRoot(event.runId);
    await ensurePrivateDirectory(runRoot);
    const eventsPath = path.join(runRoot, "events.ndjson");
    const handle = await open(eventsPath, "a", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ event, schema: runJournalSchemaId })}\n`,
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(eventsPath, 0o600);
    await syncDirectory(runRoot);
  }

  async replace(snapshot: RunSnapshot): Promise<void> {
    const events = await this.readEvents(snapshot.runId);
    if (events === null) throw new Error("Striker run journal is missing");
    await this.writeSnapshot(snapshot, events.length);
  }

  private async writeSnapshot(
    snapshot: RunSnapshot,
    eventCount: number,
  ): Promise<void> {
    const runRoot = this.runRoot(snapshot.runId);
    await ensurePrivateDirectory(runRoot);
    const target = path.join(runRoot, "snapshot.json");
    const temporary = path.join(runRoot, `snapshot.${String(process.pid)}.tmp`);
    const handle = await open(temporary, "w", 0o600);
    try {
      const normalized = runSnapshotSchema.parse(snapshot) as RunSnapshot;
      await handle.writeFile(
        `${JSON.stringify(
          {
            eventCount,
            schema: runJournalSchemaId,
            snapshot: normalized,
          },
          null,
          2,
        )}\n`,
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await chmod(target, 0o600);
    await syncDirectory(runRoot);
  }

  async delete(runId: string): Promise<void> {
    await rm(this.runRoot(runId), { force: true, recursive: true });
    await this.releaseRun(runId);
    await syncDirectory(this.#runsRoot);
  }

  async load(runId: string): Promise<RunRecoveryState | null> {
    const events = await this.readEvents(runId, true);
    if (events === null) return null;
    assertEventSequence(events, runId);
    const completedTasks = events
      .filter((event) => event.type === "task_completed")
      .map((event) => event.task);
    const snapshot =
      (await this.readSnapshot(runId, events)) ??
      recoverMissingSnapshot(events, runId);
    const lastEvent = events.at(-1);
    if (lastEvent === undefined) {
      throw new Error("Striker run journal is empty");
    }
    return { completedTasks, lastEvent, snapshot };
  }

  async loadActive(): Promise<RunRecoveryState | null> {
    const claimPath = path.join(this.#runsRoot, "active-run");
    let runId: string;
    try {
      runId = (await readFile(claimPath, "utf8")).trim();
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const recovery = await this.load(runId);
    if (recovery === null) {
      throw new Error("Active Striker run is missing its journal");
    }
    return recovery;
  }

  private async readEvents(
    runId: string,
    allowMissing = false,
  ): Promise<readonly RunJournalEvent[] | null> {
    const eventsPath = path.join(this.runRoot(runId), "events.ndjson");
    try {
      const content = await readFile(eventsPath, "utf8");
      const lines = content.split("\n").filter((line) => line.length > 0);
      return lines.map(parseEvent);
    } catch (error) {
      if (allowMissing && hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async readSnapshot(
    runId: string,
    events: readonly RunJournalEvent[],
  ): Promise<RunSnapshot | null> {
    const snapshotPath = path.join(this.runRoot(runId), "snapshot.json");
    let content: string;
    try {
      content = await readFile(snapshotPath, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const value = parseJson(content, "Invalid Striker run snapshot");
    rejectUnsupportedSchema(value);
    const parsed = snapshotEnvelopeSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("Invalid Striker run snapshot", { cause: parsed.error });
    }
    const { snapshot } = parsed.data;
    if (snapshot.runId !== runId) {
      throw new Error("Striker run snapshot contains a mismatched run id");
    }
    if (
      parsed.data.eventCount !== undefined &&
      parsed.data.eventCount > events.length
    ) {
      throw new Error("Striker run snapshot is ahead of its event journal");
    }
    const eventCount =
      parsed.data.eventCount ??
      inferSnapshotEventCount(snapshot as RunSnapshot, events);
    assertSnapshotPrefix(snapshot as RunSnapshot, events.slice(0, eventCount));
    const recovered = events
      .slice(eventCount)
      .reduce(replayEvent, snapshot as RunSnapshot);
    if (eventCount < events.length) {
      await this.writeSnapshot(recovered, events.length);
    }
    return recovered;
  }

  private async claimRun(runId: string): Promise<void> {
    const claimPath = path.join(this.#runsRoot, "active-run");
    try {
      const handle = await open(claimPath, "wx", 0o600);
      try {
        await handle.writeFile(`${runId}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(this.#runsRoot);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const active = (await readFile(claimPath, "utf8")).trim();
      if (active !== runId) {
        throw new Error(`Another Striker run is active: ${active}`, {
          cause: error,
        });
      }
    }
  }

  private async releaseRun(runId: string): Promise<void> {
    const claimPath = path.join(this.#runsRoot, "active-run");
    try {
      if ((await readFile(claimPath, "utf8")).trim() === runId) {
        await unlink(claimPath);
      }
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }

  private runRoot(runId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Invalid run id");
    return path.join(this.#runsRoot, runId);
  }
}
