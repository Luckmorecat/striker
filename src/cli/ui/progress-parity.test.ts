/**
 * Parity with the frozen reference. Every expected line below was produced by
 * the approved prototype's own layout algorithm, run on its own fixture at
 * this renderer's usable width — the terminal keeps a one-cell gutter the
 * browser has no notion of. The fixture's narration and identity reach
 * production as real run facts; the geometry, wrapping, symbols and
 * blank-line rhythm are the reference's.
 *
 * The prototype itself is archived on the throwaway branch
 * codex/terminal-ui-variant-a-prototype, commit 221aeeb, sha256
 * d4e208602515c1e08c67186ff11ba86bac4ccbcd27ce53a362280d8b9128effe. Main
 * carries only the production decision.
 */
import { describe, expect, it } from "vitest";

import { emptyDraft } from "./answer-draft.js";
import {
  dashboardDocument,
  dashboardFooter,
  type DashboardView,
} from "./progress-dashboard.js";
import type { DashboardModel } from "./progress-model.js";

const question =
  "Browser checks need missing system libraries. Should I continue with the available checks and record browser validation as blocked, or pause until the environment is fixed?";

/** The reference fixture, expressed as the facts production actually shows. */
const reference: DashboardModel = {
  attention: null,
  detail: "Round 1 · attempt 1",
  export: null,
  findings: null,
  finished: null,
  live: "The browser binary is present, but this container lacks its shared system libraries (`libglib-2.0.so.0` and related dependencies). I’m checking which browser validation steps can run in this environment before continuing with the accessibility checks.",
  pipeline: [
    { note: null, stage: "Preparing", state: "passed" },
    { note: null, stage: "Implementing", state: "active" },
    { note: null, stage: "Verifying", state: "pending" },
    { note: null, stage: "Standards review", state: "pending" },
    { note: null, stage: "Plan review", state: "pending" },
    { note: null, stage: "Completed", state: "pending" },
  ],
  plan: {
    certified: 0,
    tasks: [
      {
        id: "01-create-and-retain.md",
        state: "active",
        title: "Create and retain tasks across page reloads",
      },
      {
        id: "02-manage-and-filter.md",
        state: "pending",
        title: "Manage tasks and filter by completion status",
      },
      {
        id: "03-design-and-accessibility.md",
        state: "pending",
        title: "Design responsive layouts and accessible keyboard interactions",
      },
    ],
    total: 3,
  },
  round: 1,
  session: {
    attempt: 1,
    backend: "Docker",
    effort: "high",
    id: "striker-d18e7ed6-a3e2-4e38-8f24-76e496e52940",
    model: "gpt-5.6-sol",
  },
  stage: "Implementing",
  tool: "Inspect browser dependencies · ldd /opt/chromium/chrome",
};

function view(columns: number, rows: number): DashboardView {
  return {
    columns,
    elapsedSeconds: 743,
    expanded: false,
    frame: 0,
    motion: false,
    rows,
    scroll: 0,
  };
}

const at80 = [
  "STRIKER / run overview · 12:23 elapsed",
  "",
  "MODEL gpt-5.6-sol · effort high · Docker · attempt 1",
  "",
  "PLAN / 0 of 3 certified                              │ TASK PIPELINE",
  "                                                     │ ",
  "● 01-create-and-retain.md                            │ ✓ Preparing",
  "  Create and retain tasks across page reloads        │ ● Implementing",
  "· 02-manage-and-filter.md                            │ · Verifying",
  "  Manage tasks and filter by completion status       │ · Standards review",
  "· 03-design-and-accessibility.md                     │ · Plan review",
  "  Design responsive layouts and accessible keyboard  │ · Completed",
  "  interactions                                       │ ",
  "",
  "LIVE · The browser binary is present, but this container lacks its shared system",
  "       libraries (`libglib-2.0.so.0` and related dependencies). I’m checking",
  "       which browser validation steps can run in this environment before",
  "       continuing with the accessibility checks.",
  "TOOL · Inspect browser dependencies · ldd /opt/chromium/chrome",
  "",
  "SESSION striker-d18e7ed6-a3e2-4e38-8f24-76e496e52940",
];

const at100 = [
  "STRIKER / run overview · 12:23 elapsed",
  "",
  "MODEL gpt-5.6-sol · effort high · Docker · attempt 1",
  "",
  "PLAN / 0 of 3 certified                                                  │ TASK PIPELINE",
  "                                                                         │ ",
  "● 01-create-and-retain.md                                                │ ✓ Preparing",
  "  Create and retain tasks across page reloads                            │ ● Implementing",
  "· 02-manage-and-filter.md                                                │ · Verifying",
  "  Manage tasks and filter by completion status                           │ · Standards review",
  "· 03-design-and-accessibility.md                                         │ · Plan review",
  "  Design responsive layouts and accessible keyboard interactions         │ · Completed",
  "",
  "LIVE · The browser binary is present, but this container lacks its shared system libraries",
  "       (`libglib-2.0.so.0` and related dependencies). I’m checking which browser validation steps",
  "       can run in this environment before continuing with the accessibility checks.",
  "TOOL · Inspect browser dependencies · ldd /opt/chromium/chrome",
  "",
  "SESSION striker-d18e7ed6-a3e2-4e38-8f24-76e496e52940",
];

const at140 = [
  "STRIKER / run overview · 12:23 elapsed",
  "",
  "MODEL gpt-5.6-sol · effort high · Docker · attempt 1",
  "",
  "PLAN / 0 of 3 certified                                                                                          │ TASK PIPELINE",
  "                                                                                                                 │ ",
  "● 01-create-and-retain.md                                                                                        │ ✓ Preparing",
  "  Create and retain tasks across page reloads                                                                    │ ● Implementing",
  "· 02-manage-and-filter.md                                                                                        │ · Verifying",
  "  Manage tasks and filter by completion status                                                                   │ · Standards review",
  "· 03-design-and-accessibility.md                                                                                 │ · Plan review",
  "  Design responsive layouts and accessible keyboard interactions                                                 │ · Completed",
  "",
  "LIVE · The browser binary is present, but this container lacks its shared system libraries (`libglib-2.0.so.0` and related dependencies).",
  "       I’m checking which browser validation steps can run in this environment before continuing with the accessibility checks.",
  "TOOL · Inspect browser dependencies · ldd /opt/chromium/chrome",
  "",
  "SESSION striker-d18e7ed6-a3e2-4e38-8f24-76e496e52940",
];

/** The block the reference appends after SESSION, in the same order. */
const appended = [
  "",
  "\u2500".repeat(100),
  "? ANSWER NEEDED · run paused",
  "Browser checks need missing system libraries. Should I continue with the available checks and",
  "record browser validation as blocked, or pause until the environment is fixed?",
];

describe("frozen prototype parity", () => {
  it.each([
    [80, 24, at80],
    [100, 30, at100],
    [140, 34, at140],
  ])("reproduces the reference at %ix%i", (columns, rows, expected) => {
    expect(dashboardDocument(reference, view(columns, rows))).toEqual(expected);
  });

  it("appends the answer block the reference put after SESSION", () => {
    const paused: DashboardModel = {
      ...reference,
      attention: { detail: question, reason: "assumption_needs_decision" },
      pipeline: reference.pipeline.map((entry) =>
        entry.stage === "Implementing"
          ? { ...entry, note: "needs attention", state: "attention" as const }
          : entry,
      ),
    };
    const answering: DashboardView = {
      ...view(100, 30),
      answer: { draft: emptyDraft, editing: false, notice: null, question },
    };

    const lines = dashboardDocument(paused, answering);

    expect(lines.slice(0, at100.length)).toEqual(
      at100.map((line) => line.replace("● Implementing", "? Awaiting answer")),
    );
    expect(lines.slice(at100.length, at100.length + appended.length)).toEqual(
      appended,
    );
    // The reference drops the footer while the block carries its own hints.
    expect(dashboardFooter(paused, answering)).toEqual([]);
  });
});
