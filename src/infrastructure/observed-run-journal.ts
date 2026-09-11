import type { RunJournal } from "../core/contracts.js";
import type { RunObserver } from "../core/run-observation.js";

/**
 * Publishes persisted lifecycle facts, following the exportingJournal wrapping
 * pattern. Display is never authoritative: an observer failure leaves a
 * persisted append successful, and a failed append publishes nothing.
 */
export function observedRunJournal(
  journal: RunJournal,
  observer: RunObserver,
): RunJournal {
  return {
    append: async (event) => {
      await journal.append(event);
      try {
        observer.observe({ event, kind: "journal" });
      } catch {
        // A display observer cannot invalidate a persisted domain operation.
      }
    },
    load: (planId) => journal.load(planId),
    loadActive: () => journal.loadActive(),
  };
}
