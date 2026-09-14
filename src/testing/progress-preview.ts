/**
 * Visual fixture harness: drives the production dashboard with fake facts so
 * its appearance can be inspected at any terminal dimensions, including the
 * answer block the approved reference appends after SESSION. The approved
 * visual reference it was compared against is recorded as literal frames in
 * src/cli/ui/progress-parity.test.ts.
 * Test infrastructure only; it never enters production execution.
 */
import type { RunObservation } from "../core/run-observation.js";
import { TerminalSession } from "../cli/terminal/terminal-session.js";
import type { AnswerBlock } from "../cli/ui/answer-block.js";
import { emptyDraft } from "../cli/ui/answer-draft.js";
import {
  renderDashboard,
  type DashboardView,
} from "../cli/ui/progress-dashboard.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
  type ProgressState,
} from "../cli/ui/progress-model.js";
import { intervalClock, ProgressSession } from "../cli/ui/progress-session.js";
import {
  answerBlock,
  longQuestion,
  multilineDraft,
  shortQuestion,
} from "./answer-fixtures.js";
import {
  attentionObservation,
  previewPlan,
  previewScenario,
} from "./progress-fixtures.js";

/** Recorded facts of the run being previewed, never a current default. */
const previewSelection = { effort: "high", model: "gpt-5.6-sol" };

function dimension(variable: string, fallback: number): number {
  const value = Number(process.env[variable]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function seeded(): ProgressState {
  return initialProgress({
    backend: "docker",
    plan: previewPlan,
    selection: previewSelection,
  });
}

function view(
  columns: number,
  rows: number,
  elapsedSeconds: number,
  answer?: AnswerBlock,
  scroll = 0,
): DashboardView {
  return {
    ...(answer === undefined ? {} : { answer }),
    columns,
    elapsedSeconds,
    expanded: false,
    frame: 0,
    motion: false,
    rows,
    scroll,
  };
}

function print(label: string, lines: readonly string[]): void {
  process.stdout.write(`\n--- ${label} ---\n${lines.join("\n")}\n`);
}

/** Without a terminal, print every step's frame so parity stays inspectable. */
function dumpFrames(columns: number, rows: number): void {
  let state = seeded();
  previewScenario.forEach((observation, index) => {
    state = applyObservation(state, observation);
    print(
      `step ${String(index + 1)} · ${String(columns)}x${String(rows)}`,
      renderDashboard(
        dashboardModel(state),
        view(columns, rows, (index + 1) * 6),
      ).lines,
    );
  });
}

/** The paused run with the reference's short and long answers appended. */
function dumpAnswerFrames(columns: number, rows: number): void {
  let state = seeded();
  for (const observation of previewScenario) {
    state = applyObservation(state, observation);
    if (observation === attentionObservation) break;
  }
  const model = dashboardModel(state);
  const cases = [
    [
      "short question · browsing",
      answerBlock(shortQuestion, emptyDraft, false),
    ],
    ["short question · editing", answerBlock(shortQuestion, emptyDraft, true)],
    [
      "short question · multiline draft",
      answerBlock(shortQuestion, multilineDraft, true),
    ],
    [
      "long question · editing",
      answerBlock(longQuestion, multilineDraft, true),
    ],
  ] as const;
  for (const [label, answer] of cases) {
    const size = `${String(columns)}x${String(rows)}`;
    print(
      `answer ${label} · ${size}`,
      renderDashboard(model, view(columns, rows, 743, answer)).lines,
    );
    print(
      `answer ${label} · ${size} · scrolled to the caret`,
      renderDashboard(model, {
        ...view(columns, rows, 743, answer),
        follow: true,
      }).lines,
    );
  }
}

function interactive(): void {
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
    seed: {
      backend: "docker",
      plan: previewPlan,
      selection: previewSelection,
    },
    terminal,
  });
  let step = 0;
  const timer = setInterval(
    () => {
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
      if (next !== attentionObservation) return;
      // The reference pauses here: the question and editor join the dashboard.
      clearInterval(timer);
      void session
        .answer(
          process.env.PREVIEW_QUESTION === "long"
            ? longQuestion
            : shortQuestion,
        )
        .then((input) => {
          session.dispose();
          process.stdout.write(`${JSON.stringify(input)}\n`);
        });
    },
    dimension("PREVIEW_INTERVAL", 1_200),
  );
}

function main(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const columns = dimension("PREVIEW_COLUMNS", 100);
    const rows = dimension("PREVIEW_ROWS", 30);
    if (process.env.PREVIEW_SECTION !== "answer") dumpFrames(columns, rows);
    if (process.env.PREVIEW_SECTION !== "run") dumpAnswerFrames(columns, rows);
    return;
  }
  interactive();
}

main();
