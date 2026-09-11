import type { RunJournalEvent } from "./run-journal-contracts.js";

/** Persisted facts of one run, replayed read-only for display reconstruction. */
export interface RunHistory {
  readonly events: readonly RunJournalEvent[];
  readonly planId: string;
  readonly runId: string;
}

export interface RunHistoryReader {
  readActive(): Promise<RunHistory | null>;
}
