import type { RunHistory, RunHistoryReader } from "../core/run-history.js";
import type { FileRunJournal } from "./file-run-journal.js";

/**
 * Read-only projection over the journal the run already validates. Display
 * reconstruction adds no durable state and no second parsing authority.
 */
export class FileRunHistoryReader implements RunHistoryReader {
  constructor(private readonly journal: FileRunJournal) {}

  async readActive(): Promise<RunHistory | null> {
    const active = await this.journal.loadActive();
    const snapshot = active === null ? null : active.snapshot;
    if (active === null || snapshot === null) return null;
    const events = await this.journal.readHistory(active.planId);
    if (events === null) return null;
    return {
      events: events.filter((event) => event.runId === snapshot.runId),
      planId: active.planId,
      runId: snapshot.runId,
    };
  }
}
