import type { Verifier } from "../../core/contracts.js";
import type {
  RunObservationPublisher,
  RunObserver,
} from "../../core/run-observation.js";

/** One publisher per command: no process-global state, no event bus. */
export function createRunObservations(): RunObservationPublisher {
  const observers = new Set<RunObserver>();
  return {
    close: () => {
      observers.clear();
    },
    observe: (observation) => {
      for (const observer of [...observers]) {
        try {
          observer.observe(observation);
        } catch {
          // One broken display must not silence the rest of the command.
        }
      }
    },
    subscribe: (observer) => {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
  };
}

/** Verification has no journal event, so its flight is observed transiently. */
export function observedVerifier(
  verifier: Verifier,
  observer: RunObserver,
): Verifier {
  const report = (
    phase: "finished" | "started",
    command: string,
    exitCode?: number,
  ) => {
    try {
      observer.observe({
        command,
        ...(exitCode === undefined ? {} : { exitCode }),
        kind: "verification",
        phase,
      });
    } catch {
      // Display never decides whether verification ran or what it returned.
    }
  };
  return {
    verify: async (request) => {
      report("started", request.command);
      try {
        const result = await verifier.verify(request);
        report("finished", request.command, result.exitCode);
        return result;
      } catch (error) {
        report("finished", request.command);
        throw error;
      }
    },
  };
}
