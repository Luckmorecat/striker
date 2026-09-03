import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
} from "../core/contracts.js";
import { terminalRunStatus } from "../core/run-state.js";
import {
  assertSnapshotPrefix,
  replayPlanJournal,
} from "./run-journal-sequence.js";
import {
  eventEnvelopeSchema,
  runJournalEventSchema,
  runJournalSchemaId,
  snapshotEnvelopeSchema,
} from "./run-journal-schema.js";
import { writePlanProjections } from "./plan-projections.js";

interface ActiveClaim {
  readonly ownerPid: number;
  readonly planId: string;
  readonly runId: string;
}

interface ClaimedRun {
  readonly claim: ActiveClaim;
  readonly created: boolean;
}

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
  if (schema !== runJournalSchemaId) {
    const label = typeof schema === "string" ? schema : JSON.stringify(schema);
    throw new Error(`Unsupported Striker plan journal schema: ${label}`);
  }
}

function parseEvent(line: string): RunJournalEvent {
  const value = parseJson(line, "Invalid Striker plan journal event");
  rejectUnsupportedSchema(value);
  const parsed = eventEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid Striker plan journal event", {
      cause: parsed.error,
    });
  }
  return parsed.data.event as RunJournalEvent;
}

function validateId(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${label}`);
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasCode(error, "ESRCH");
  }
}

function isActiveClaim(value: unknown): value is ActiveClaim {
  return (
    typeof value === "object" &&
    value !== null &&
    "planId" in value &&
    typeof value.planId === "string" &&
    "ownerPid" in value &&
    typeof value.ownerPid === "number" &&
    Number.isInteger(value.ownerPid) &&
    value.ownerPid > 0 &&
    "runId" in value &&
    typeof value.runId === "string"
  );
}

export class FileRunJournal implements RunJournal {
  readonly #claimPath: string;
  readonly #plansRoot: string;

  constructor(private readonly stateRoot: string) {
    this.#claimPath = path.join(stateRoot, "active-run.json");
    this.#plansRoot = path.join(stateRoot, "plans");
  }

  async append(event: RunJournalEvent): Promise<void> {
    const normalized = runJournalEventSchema.parse(event) as RunJournalEvent;
    await ensurePrivateDirectory(this.stateRoot);
    await ensurePrivateDirectory(this.#plansRoot);
    const claimed =
      normalized.type === "run_started"
        ? await this.claimRun(normalized.planId, normalized.runId)
        : { claim: await this.requireClaim(normalized.runId), created: false };
    const { claim } = claimed;
    const planRoot = this.planRoot(claim.planId);
    let appended = false;
    try {
      await ensurePrivateDirectory(planRoot);
      const previous = (await this.readEvents(claim.planId, true)) ?? [];
      const duplicate = isDeepStrictEqual(previous.at(-1), normalized);
      const events = duplicate ? previous : [...previous, normalized];
      const recovery = replayPlanJournal(events, claim.planId);
      if (!duplicate) await this.appendEvent(planRoot, normalized);
      appended = true;
      await writePlanProjections(
        planRoot,
        claim.planId,
        recovery.snapshot,
        events,
      );
      if (terminalRunStatus(normalized) !== null) await this.releaseRun(claim);
    } catch (error) {
      if (claimed.created && !appended) await this.releaseRun(claim);
      throw error;
    }
  }

  async load(planId: string): Promise<RunRecoveryState | null> {
    const events = await this.readEvents(planId, true);
    if (events === null) return null;
    const recovery = replayPlanJournal(events, planId);
    await this.readSnapshot(planId, events);
    await writePlanProjections(
      this.planRoot(planId),
      planId,
      recovery.snapshot,
      events,
    );
    return recovery;
  }

  async loadActive(): Promise<RunRecoveryState | null> {
    const claim = await this.readClaim();
    if (claim === null) return null;
    const recovery = await this.load(claim.planId);
    if (recovery === null) {
      if (processIsRunning(claim.ownerPid)) {
        throw new Error("Active Striker run is still initializing");
      }
      await this.releaseRun(claim);
      return null;
    }
    const snapshot = recovery.snapshot;
    if (snapshot?.runId !== claim.runId) {
      throw new Error("Active Striker run is missing its plan journal");
    }
    if (snapshot.status === "completed" || snapshot.status === "discarded") {
      await this.releaseRun(claim);
      return null;
    }
    return recovery;
  }

  private async appendEvent(
    planRoot: string,
    event: RunJournalEvent,
  ): Promise<void> {
    const eventsPath = path.join(planRoot, "events.ndjson");
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
    await syncDirectory(planRoot);
  }

  private async readEvents(
    planId: string,
    allowMissing: boolean,
  ): Promise<readonly RunJournalEvent[] | null> {
    const eventsPath = path.join(this.planRoot(planId), "events.ndjson");
    try {
      const content = await readFile(eventsPath, "utf8");
      return content
        .split("\n")
        .filter((line) => line.length > 0)
        .map(parseEvent);
    } catch (error) {
      if (allowMissing && hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async readSnapshot(
    planId: string,
    events: readonly RunJournalEvent[],
  ): Promise<{ readonly eventCount: number } | null> {
    const snapshotPath = path.join(this.planRoot(planId), "snapshot.json");
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
    const count = parsed.data.eventCount ?? events.length;
    if (count > events.length) {
      throw new Error("Striker run snapshot is ahead of its plan journal");
    }
    assertSnapshotPrefix(
      parsed.data.snapshot as RunSnapshot,
      events.slice(0, count),
      planId,
    );
    return { eventCount: count };
  }

  private async claimRun(planId: string, runId: string): Promise<ClaimedRun> {
    validateId(planId, "plan identity");
    validateId(runId, "run id");
    const claim = { ownerPid: process.pid, planId, runId };
    try {
      const handle = await open(this.#claimPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(claim)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(this.stateRoot);
      return { claim, created: true };
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const active = await this.readClaim();
      if (active?.runId !== runId || active.planId !== planId) {
        throw new Error(
          `Another Striker run is active: ${active?.runId ?? "unknown"}`,
          { cause: error },
        );
      }
      return { claim: active, created: false };
    }
  }

  private async requireClaim(runId: string): Promise<ActiveClaim> {
    const claim = await this.readClaim();
    if (claim?.runId !== runId) {
      throw new Error("Striker event does not belong to the active run");
    }
    return claim;
  }

  private async readClaim(): Promise<ActiveClaim | null> {
    try {
      const value = parseJson(
        await readFile(this.#claimPath, "utf8"),
        "Invalid active Striker run index",
      );
      if (!isActiveClaim(value)) {
        throw new Error("Invalid active Striker run index");
      }
      return value;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async releaseRun(claim: ActiveClaim): Promise<void> {
    const active = await this.readClaim();
    if (active?.planId === claim.planId && active.runId === claim.runId) {
      await unlink(this.#claimPath);
      await syncDirectory(this.stateRoot);
    }
  }

  private planRoot(planId: string): string {
    validateId(planId, "plan identity");
    return path.join(this.#plansRoot, planId);
  }
}
