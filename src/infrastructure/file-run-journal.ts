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
  RunSnapshot,
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
      if (!this.hasCode(error, "EEXIST")) throw error;
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
      if (!this.hasCode(error, "ENOENT")) throw error;
    }
  }

  private hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
  }

  private runRoot(runId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Invalid run id");
    return path.join(this.#runsRoot, runId);
  }
}
