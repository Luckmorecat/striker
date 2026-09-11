import type { RunJournalEvent } from "./run-journal-contracts.js";

/** Facts a command may publish for display, independent of any UI framework. */
export type RunObservation =
  | { readonly kind: "journal"; readonly event: RunJournalEvent }
  | {
      readonly kind: "preparation";
      readonly detail: string;
      readonly phase: "started" | "ready" | "failed";
    }
  | {
      readonly kind: "verification";
      readonly command: string;
      readonly exitCode?: number;
      readonly phase: "started" | "finished";
    };

export interface RunObserver {
  observe(observation: RunObservation): void;
}

/** One publisher per command; subscriptions are disposed with the command. */
export interface RunObservationPublisher extends RunObserver {
  subscribe(observer: RunObserver): () => void;
  close(): void;
}
