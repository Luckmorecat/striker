import type { RunStatus, RunTransition } from "./contracts.js";

const transitions: Readonly<
  Record<RunStatus, Readonly<Partial<Record<RunTransition, RunStatus>>>>
> = {
  created: { start: "running" },
  running: {
    complete_task: "running",
    complete: "completed",
    fail: "failed",
    request_attention: "needs_attention",
  },
  needs_attention: { resume: "running" },
  failed: { retry: "running" },
  completed: {},
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
