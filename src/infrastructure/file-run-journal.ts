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
  RunRecoveryState,
  RunJournal,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";

const schema = "striker.run.v1";

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

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error(message);
  return value as Record<string, unknown>;
}

function taskIdentity(value: unknown): TaskIdentity {
  const task = requireRecord(
    value,
    "Invalid completed task in Striker run journal",
  );
  if (typeof task.id !== "string" || typeof task.revision !== "string") {
    throw new Error("Invalid completed task in Striker run journal");
  }
  return { id: task.id, revision: task.revision };
}

function completedTaskFromLine(
  line: string,
  runId: string,
): TaskIdentity | null {
  const value = requireRecord(
    JSON.parse(line) as unknown,
    "Invalid Striker run journal event",
  );
  if (value.schema !== schema) {
    throw new Error(
      `Unsupported Striker run journal schema: ${String(value.schema)}`,
    );
  }
  const event = requireRecord(value.event, "Invalid Striker run journal event");
  if (event.runId !== runId) {
    throw new Error("Striker run journal contains a mismatched run id");
  }
  return event.type === "task_completed" ? taskIdentity(event.task) : null;
}

export class FileRunJournal implements RunJournal {
  readonly #runsRoot: string;

  constructor(stateRoot: string) {
    this.#runsRoot = path.join(stateRoot, "runs");
  }

  async append(event: RunJournalEvent): Promise<void> {
    await ensurePrivateDirectory(this.#runsRoot);
    if (event.type === "run_started") await this.claimRun(event.runId);
    const runRoot = this.runRoot(event.runId);
    await ensurePrivateDirectory(runRoot);
    const eventsPath = path.join(runRoot, "events.ndjson");
    const handle = await open(eventsPath, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ event, schema })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(eventsPath, 0o600);
    await syncDirectory(runRoot);
  }

  async replace(snapshot: RunSnapshot): Promise<void> {
    const runRoot = this.runRoot(snapshot.runId);
    await ensurePrivateDirectory(runRoot);
    const target = path.join(runRoot, "snapshot.json");
    const temporary = path.join(runRoot, `snapshot.${String(process.pid)}.tmp`);
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ schema, snapshot }, null, 2)}\n`,
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
    const eventsPath = path.join(this.runRoot(runId), "events.ndjson");
    let content: string;
    try {
      content = await readFile(eventsPath, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const completedTasks = content
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => completedTaskFromLine(line, runId))
      .filter((task): task is TaskIdentity => task !== null);
    return { completedTasks };
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
