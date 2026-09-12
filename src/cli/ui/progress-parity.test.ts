/**
 * Durable parity fixtures. Every expected line below was captured from the
 * painted output of src/cli/terminal/progress.prototype.ts, the approved visual
 * reference, before it was deleted. Only two kinds of substitution were made:
 * the mock identity it printed (`demo-42`, `Docker (mock)`, `simulated
 * elapsed`) and the mock narration on its LIVE and TOOL lines, which production
 * fills from real facts and real streamed agent activity. Layout, spacing,
 * symbols, column geometry and colours are the reference's, unchanged.
 */
import { describe, expect, it } from "vitest";

import {
  previewPlan,
  previewScenario,
} from "../../testing/progress-fixtures.js";
import { renderDashboard } from "./progress-dashboard.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
} from "./progress-model.js";

function frame(
  steps: number,
  elapsedSeconds: number,
  view: { readonly expanded?: boolean; readonly motion?: number } = {},
): readonly string[] {
  const state = previewScenario
    .slice(0, steps)
    .reduce(
      applyObservation,
      initialProgress({ backend: "docker", plan: previewPlan }),
    );
  return renderDashboard(dashboardModel(state), {
    columns: 100,
    elapsedSeconds,
    expanded: view.expanded ?? false,
    frame: view.motion ?? 0,
    motion: view.motion !== undefined,
    rows: 40,
    scroll: 0,
  });
}

/** The reference painted with ANSI escapes; "~" stands in for one. */
function painted(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.replaceAll("~", "\u001B"));
}

function matches(
  steps: number,
  elapsedSeconds: number,
  expected: readonly string[],
): void {
  expect(frame(steps, elapsedSeconds).slice(0, expected.length)).toEqual(
    painted(expected),
  );
}

const attentionFrame = [
  "~[0mSTRIKER / run overview · 0:24 elapsed~[0m",
  "~[0m~[0m",
  "~[0mPLAN / 1 of 5 certified          │ TASK PIPELINE~[0m",
  "~[0m                                 │ ~[0m",
  "~[0m~[32m✓ 01  Recovery contracts         ~[0m│ ~[32m✓ Preparing~[0m~[0m",
  "~[36m● 02  Answer command             │ ? Implementing · needs attention~[0m",
  "~[0m· 03  Terminal handoff           │ · Verifying~[0m",
  "~[0m· 04  Recovery guidance          │ · Standards review~[0m",
  "~[0m· 05  Documentation              │ · Plan review~[0m",
  "~[0m                                 │ · Completed~[0m",
  "~[0mSESSION session-42               │ ~[0m",
  "~[0mAttempt 1 · Docker               │ ~[0m",
  "~[0m~[0m",
  "~[36mLIVE · Should blank answers reprompt, or leave the run paused?~[0m",
  "~[0mTOOL · Read recovery-policy.ts~[0m",
];

const blockedFrame = [
  "~[0mSTRIKER / run overview · 1:12 elapsed~[0m",
  "~[0m~[0m",
  "~[0mPLAN / 1 of 5 certified          │ TASK PIPELINE~[0m",
  "~[0m                                 │ ~[0m",
  "~[0m~[32m✓ 01  Recovery contracts         ~[0m│ ~[32m✓ Preparing~[0m~[0m",
  "~[36m● 02  Answer command             │ ~[32m✓ Implementing~[36m~[0m",
  "~[0m· 03  Terminal handoff           │ ~[32m✓ Verifying~[0m~[0m",
  "~[0m· 04  Recovery guidance          │ ~[31m! Standards review · 2 blockers~[0m",
  "~[0m· 05  Documentation              │ · Plan review~[0m",
  "~[0m                                 │ · Completed~[0m",
  "~[0mSESSION session-42               │ ~[0m",
  "~[0mAttempt 1 · Docker               │ ~[0m",
  "~[0m~[0m",
  "~[0m~[31m! REVIEW · 2 blocking findings from round 1~[0m",
  "~[0m  • Input consumed before eligibility is checked~[0m",
  "~[0m  • Cancelled input incorrectly resumes the session~[0m",
  "~[36mLIVE · Standards review found 2 blocking findings. Returning to implementation.~[0m",
  "~[0mTOOL · Review candidate candida~[0m",
];

const certifiedFrame = [
  "~[0mSTRIKER / run overview · 2:12 elapsed~[0m",
  "~[0m~[0m",
  "~[0mPLAN / 2 of 5 certified          │ TASK PIPELINE~[0m",
  "~[0m                                 │ ~[0m",
  "~[0m~[32m✓ 01  Recovery contracts         ~[0m│ ~[32m✓ Preparing~[0m~[0m",
  "~[0m~[32m✓ 02  Answer command             ~[0m│ ~[32m✓ Implementing~[0m~[0m",
  "~[0m· 03  Terminal handoff           │ ~[32m✓ Verifying~[0m~[0m",
  "~[0m· 04  Recovery guidance          │ ~[32m✓ Standards review~[0m~[0m",
  "~[0m· 05  Documentation              │ ~[32m✓ Plan review~[0m~[0m",
  "~[0m                                 │ ~[32m✓ Completed~[0m~[0m",
  "~[0mSESSION session-42               │ ~[0m",
  "~[0mAttempt 1 · Docker               │ ~[0m",
  "~[0m~[0m",
  "~[0m~[32m✓ Review history · round 1: 2 blockers → round 2: resolved~[0m~[0m",
  "~[36mLIVE · Certified task 02 after 2 implementation rounds.~[0m",
  "~[0mTOOL · Commit candida~[0m",
];

const shimmeringFrame = [
  "~[0mSTRIKER / run overview · 1:00 elapsed~[0m",
  "~[0m~[0m",
  "~[0mPLAN / 1 of 5 certified          │ TASK PIPELINE~[0m",
  "~[0m                                 │ ~[0m",
  "~[0m~[32m✓ 01  Recovery contracts         ~[0m│ ~[32m✓ Preparing~[0m~[0m",
  "~[36m● 02  Answer command             │ ~[32m✓ Implementing~[36m~[0m",
  "~[0m· 03  Terminal handoff           │ ~[32m✓ Verifying~[0m~[0m",
  "~[36m· 04  Recovery guidance          │ ~[38;5;67m●~[38;5;67m ~[38;5;67mS~[38;5;67mt~[38;5;67ma~[38;5;67mn~[38;5;67md~[38;5;67ma~[38;5;67mr~[38;5;67md~[38;5;67ms~[38;5;67m ~[38;5;67mr~[38;5;67me~[38;5;67mv~[38;5;67mi~[38;5;67me~[38;5;67mw~[36m~[0m",
  "~[0m· 05  Documentation              │ · Plan review~[0m",
  "~[0m                                 │ · Completed~[0m",
  "~[0mSESSION session-42               │ ~[0m",
  "~[0mAttempt 1 · Docker               │ ~[0m",
  "~[0m~[0m",
  "~[36mLIVE · Reviewing candidate candida against project standards.~[0m",
  "~[0mTOOL · Review candidate candida~[0m",
];

const expandedFrame = [
  "~[0mSTRIKER / run overview · 0:36 elapsed~[0m",
  "~[0m~[0m",
  "~[0mPLAN / 1 of 5 certified          │ TASK PIPELINE~[0m",
  "~[0m                                 │ ~[0m",
  "~[0m~[32m✓ 01  Recovery contracts         ~[0m│ ~[32m✓ Preparing~[0m~[0m",
  "~[36m● 02  Answer command             │ ● Implementing~[0m",
  "~[0m· 03  Terminal handoff           │ · Verifying~[0m",
  "~[0m· 04  Recovery guidance          │ · Standards review~[0m",
  "~[0m· 05  Documentation              │ · Plan review~[0m",
  "~[0m                                 │ · Completed~[0m",
  "~[0mSESSION session-42               │ ~[0m",
  "~[0mAttempt 1 · Docker               │ ~[0m",
  "~[0m~[0m",
  "~[36mLIVE · Applying your decision to the answer editor.~[0m",
  "~[0mTOOL · Edit answer-command.ts~[0m",
  "~[0mRound 1 · attempt 1~[0m",
];

describe("prototype parity", () => {
  it("paints attention exactly as the visual reference did", () => {
    matches(9, 24, attentionFrame);
  });

  it("paints a blocking review exactly as the visual reference did", () => {
    matches(16, 72, blockedFrame);
  });

  it("paints resolved certification exactly as the visual reference did", () => {
    matches(26, 132, certifiedFrame);
  });

  it("shimmers the active stage exactly as the visual reference did", () => {
    expect(
      frame(15, 60, { motion: 7 }).slice(0, shimmeringFrame.length),
    ).toEqual(painted(shimmeringFrame));
  });

  it("places the expanded detail line where the visual reference did", () => {
    expect(
      frame(12, 36, { expanded: true }).slice(0, expandedFrame.length),
    ).toEqual(painted(expandedFrame));
  });

  it("paints attention where the reference did: the question, not the row", () => {
    const state = previewScenario
      .slice(0, 9)
      .reduce(
        applyObservation,
        initialProgress({ backend: "docker", plan: previewPlan }),
      );

    // Below the two-column width the pipeline is the row, and it asks.
    const narrow = renderDashboard(dashboardModel(state), {
      columns: 60,
      elapsedSeconds: 24,
      expanded: false,
      frame: 0,
      motion: false,
      rows: 24,
      scroll: 0,
    });

    expect(narrow).toContain(
      painted(["~[33m? Implementing · needs attention~[0m"])[0],
    );
    expect(narrow).toContain(
      painted([
        "~[33m? Should blank answers reprompt, or leave the run paused?~[0m",
      ])[0],
    );
  });
});
