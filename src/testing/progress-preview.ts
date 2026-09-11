/**
 * Visual fixture harness: drives the production dashboard with fake facts so
 * its appearance can be compared with the prototype at the same dimensions.
 * Test infrastructure only; it never enters production execution.
 */
import type { RunObservation } from "../core/run-observation.js";
import { TerminalSession } from "../cli/terminal/terminal-session.js";
import { renderDashboard } from "../cli/ui/progress-dashboard.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
} from "../cli/ui/progress-model.js";
import { intervalClock, ProgressSession } from "../cli/ui/progress-session.js";
import {
  blockingResult,
  implementing,
  journal,
  passedOnB,
  progressSession,
  progressTask,
  progressVerification,
  repairStarted,
  reviewCompleted,
  reviewStarted,
  verified,
  verifying,
} from "./progress-fixtures.js";

const attention = journal({
  attention: {
    detail: "Should blank answers reprompt, or leave the run paused?",
    reason: "assumption_needs_decision",
  },
  runId: "run",
  session: progressSession,
  task: progressTask.identity,
  type: "run_needs_attention",
});

const answered = journal({
  answer: "Reprompt on blank answers.",
  runId: "run",
  session: progressSession,
  task: progressTask.identity,
  type: "run_answered",
});

const planReview = journal({
  attempt: 1,
  changedPaths: ["src/a.ts"],
  completion: { summary: "done" },
  resultCommit: "candidate-b",
  runId: "run",
  session: progressSession,
  standards: passedOnB,
  startCommit: "base",
  task: progressTask.identity,
  type: "plan_compliance_review_started",
  verification: progressVerification,
});

const certified = journal({
  attempt: 1,
  certification: "independent_reviews",
  changedPaths: ["src/a.ts"],
  completedAt: "2026-09-12T00:00:00.000Z",
  resultCommit: "candidate-b",
  runId: "run",
  session: progressSession,
  startCommit: "base",
  task: progressTask.identity,
  type: "task_completed",
  verification: progressVerification,
});

/** Mirrors the prototype timeline as authoritative facts, one step per entry. */
export const previewScenario: readonly RunObservation[] = [
  {
    detail: "Opening the retained workspace.",
    kind: "preparation",
    phase: "started",
  },
  ...implementing,
  attention,
  answered,
  verifying,
  verified,
  reviewStarted("candidate-a"),
  reviewCompleted(blockingResult),
  repairStarted(blockingResult),
  verifying,
  verified,
  reviewStarted("candidate-b"),
  reviewCompleted(passedOnB),
  planReview,
  journal({
    result: {
      discoveryDecisions: [],
      findings: [],
      kind: "plan_compliance",
      outcomeFactDecisions: [],
      resultCommit: "candidate-b",
      startCommit: "base",
      verdict: "passed",
    },
    runId: "run",
    session: progressSession,
    task: progressTask.identity,
    type: "plan_compliance_review_completed",
  }),
  certified,
  journal({ runId: "run", type: "run_completed" }),
];

export const previewPlan = {
  tasks: [
    "Recovery contracts",
    "Answer command",
    "Terminal handoff",
    "Recovery guidance",
    "Documentation",
  ].map((title, index) => ({
    id: String(index + 1).padStart(2, "0"),
    title,
  })),
};

function dimension(variable: string, fallback: number): number {
  const value = Number(process.env[variable]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Without a terminal, print every step's frame so parity stays inspectable. */
function dumpFrames(columns: number, rows: number): void {
  let state = initialProgress({ backend: "docker", plan: previewPlan });
  previewScenario.forEach((observation, index) => {
    state = applyObservation(state, observation);
    const frame = renderDashboard(dashboardModel(state), {
      columns,
      elapsedSeconds: (index + 1) * 6,
      expanded: false,
      frame: 0,
      motion: false,
      rows,
      scroll: 0,
    });
    process.stdout.write(
      `\n--- step ${String(index + 1)} · ${String(columns)}x${String(rows)} ---\n${frame.join("\n")}\n`,
    );
  });
}

function main(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    dumpFrames(
      dimension("PREVIEW_COLUMNS", 100),
      dimension("PREVIEW_ROWS", 30),
    );
    return;
  }
  const terminal = new TerminalSession(process.stdin, process.stdout);
  const observers = new Set<{ observe: (o: RunObservation) => void }>();
  let elapsed = 0;
  const session = ProgressSession.start({
    clock: intervalClock(),
    elapsed: () => elapsed,
    observations: {
      close: () => {
        observers.clear();
      },
      observe: (observation) => {
        for (const observer of observers) observer.observe(observation);
      },
      subscribe: (observer) => {
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    },
    onInterrupt: () => {
      process.exit(130);
    },
    seed: { backend: "docker", plan: previewPlan },
    terminal,
  });
  let step = 0;
  const timer = setInterval(() => {
    elapsed += 1;
    const next = previewScenario[step];
    if (next === undefined) {
      clearInterval(timer);
      session.dispose();
      process.stdout.write("Preview complete.\n");
      return;
    }
    step += 1;
    for (const observer of observers) observer.observe(next);
  }, 1_200);
}

main();
