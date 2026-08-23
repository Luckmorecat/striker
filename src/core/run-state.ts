import type {
  RunJournalEvent,
  RunStatus,
  RunTransition,
} from "./run-journal-contracts.js";

const transitions: Readonly<
  Record<RunStatus, Readonly<Partial<Record<RunTransition, RunStatus>>>>
> = {
  created: { start: "running" },
  running: {
    complete_task: "running",
    complete: "completed",
    fail: "failed",
    request_attention: "needs_attention",
    resume: "running",
  },
  needs_attention: {
    answer: "running",
    complete_task: "needs_attention",
    discard: "discarded",
    resume: "running",
    retry: "running",
  },
  failed: { discard: "discarded", retry: "running" },
  completed: {},
  discarded: {},
};

export function transitionRun(
  current: RunStatus,
  transition: RunTransition,
): RunStatus {
  const next = transitions[current][transition];

  if (next === undefined) {
    throw new Error(`Illegal run transition: ${current} -> ${transition}`);
  }

  return next;
}

export function terminalRunStatus(
  event: RunJournalEvent,
): "completed" | "discarded" | null {
  if (event.type === "run_completed") return "completed";
  if (event.type === "run_discarded") return "discarded";
  return null;
}
