/**
 * Visual fixture harness: drives the production dashboard with fake facts so
 * its appearance can be inspected at any terminal dimensions. The approved
 * visual reference it was compared against is recorded as literal frames in
 * src/cli/ui/progress-parity.test.ts.
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
import { previewPlan, previewScenario } from "./progress-fixtures.js";

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
