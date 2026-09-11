import { describe, expect, it } from "vitest";

import {
  dashboardBody,
  dashboardFooter,
  effectiveScroll,
  renderDashboard,
} from "./progress-dashboard.js";
import type { DashboardModel } from "./progress-model.js";

const escape = "\u001B";
const view = {
  columns: 100,
  elapsedSeconds: 72,
  expanded: false,
  frame: 0,
  motion: false,
  rows: 30,
  scroll: 0,
};

const base: DashboardModel = {
  attention: null,
  detail: "Round 2 · attempt 1 · candidate candida",
  export: null,
  findings: null,
  finished: null,
  live: "Fixing 2 blocking review findings.",
  pipeline: [
    { note: null, stage: "Preparing", state: "passed" },
    { note: "round 2", stage: "Implementing", state: "active" },
    { note: "recheck required", stage: "Verifying", state: "recheck" },
    { note: "recheck due", stage: "Standards review", state: "blocked" },
    { note: null, stage: "Plan review", state: "pending" },
    { note: null, stage: "Completed", state: "pending" },
  ],
  plan: {
    certified: 1,
    tasks: [
      { id: "01", state: "certified", title: "Recovery contracts" },
      { id: "02", state: "active", title: "Answer command" },
      { id: "03", state: "pending", title: "Terminal handoff" },
    ],
    total: 3,
  },
  round: 2,
  session: { attempt: 1, backend: "Docker", id: "demo-42" },
  stage: "Implementing",
  tool: "No activity reported",
};

function visible(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line.replaceAll(new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, "gu"), ""),
  );
}

describe("dashboard body", () => {
  it("heads the dashboard with the elapsed run clock", () => {
    expect(dashboardBody(base, view)[0]).toBe(
      "STRIKER / run overview · 1:12 elapsed",
    );
  });

  it("lays the plan beside the pipeline in a wide terminal", () => {
    const lines = dashboardBody(base, view);

    expect(lines[2]).toBe(
      `${"PLAN / 1 of 3 certified".padEnd(32)} │ TASK PIPELINE`,
    );
    expect(lines[4]).toBe(
      `${"✓ 01  Recovery contracts".padEnd(32)} │ ✓ Preparing`,
    );
    expect(lines[5]).toBe(
      `${"● 02  Answer command".padEnd(32)} │ ● Implementing · round 2`,
    );
    expect(lines[6]).toBe(
      `${"· 03  Terminal handoff".padEnd(32)} │ ↻ Verifying · recheck required`,
    );
  });

  it("keeps every pipeline stage when the plan column is shorter", () => {
    const lines = dashboardBody(base, view).join("\n");

    expect(lines).toContain("! Standards review · recheck due");
    expect(lines).toContain("· Plan review");
    expect(lines).toContain("· Completed");
  });

  it("shows the session and execution context under the plan", () => {
    const left = dashboardBody(base, view).map((line) =>
      line.split(" │ ")[0]?.trimEnd(),
    );

    expect(left).toContain("SESSION demo-42");
    expect(left).toContain("Attempt 1 · Docker");
  });

  it("drops to the pipeline alone in a narrow terminal", () => {
    const lines = dashboardBody(base, { ...view, columns: 60 });

    expect(lines[2]).toBe("TASK PIPELINE");
    expect(lines).not.toContain("PLAN / 1 of 3 certified");
    expect(lines.every((line) => Array.from(line).length <= 58)).toBe(true);
  });

  it("shows findings above the activity lines", () => {
    const lines = dashboardBody(
      {
        ...base,
        findings: {
          headline: "! REVIEW · 2 blocking findings from round 1",
          items: ["  • Input consumed too early"],
          status: "blocking",
        },
      },
      view,
    );

    expect(lines.slice(-4)).toEqual([
      "! REVIEW · 2 blocking findings from round 1",
      "  • Input consumed too early",
      "LIVE · Fixing 2 blocking review findings.",
      "TOOL · No activity reported",
    ]);
  });

  it("adds the tool line and reveals the detail only when expanded", () => {
    expect(dashboardBody(base, view).at(-1)).toBe(
      "TOOL · No activity reported",
    );
    expect(dashboardBody(base, { ...view, expanded: true }).at(-1)).toBe(
      "Round 2 · attempt 1 · candidate candida",
    );
  });
});

describe("plans larger than the panel", () => {
  it("keeps the active task visible in a plan larger than the panel", () => {
    const tasks = Array.from({ length: 40 }, (_, index) => ({
      id: String(index + 1).padStart(2, "0"),
      state: index === 30 ? ("active" as const) : ("pending" as const),
      title: `Task ${String(index + 1)}`,
    }));
    const lines = dashboardBody(
      { ...base, plan: { certified: 0, tasks, total: 40 } },
      { ...view, rows: 20 },
    );

    expect(lines.join("\n")).toContain("● 31  Task 31");
  });

  it("scrolls the plan window through a long plan while expanded", () => {
    const at = (scroll: number) =>
      dashboardBody(
        { ...base, plan: longPlan(40, 30) },
        { ...view, expanded: true, rows: 20, scroll },
      ).join("\n");

    expect(at(0)).toContain("● 31  Task 31");
    expect(at(0)).not.toContain("· 01  Task 1\n");
    expect(at(-40)).toContain("· 01  Task 1");
    expect(at(40)).toContain("· 40  Task 40");
    expect(
      visible(
        renderDashboard(
          { ...base, plan: longPlan(40, 30) },
          { ...view, expanded: true, rows: 20, scroll: 40 },
        ),
      ).join("\n"),
    ).toContain("LIVE · Fixing 2 blocking review findings.");
  });

  it("reports the scroll a frame could honour so arrows never go dead", () => {
    const model = { ...base, plan: longPlan(40, 30) };
    const expanded = { ...view, expanded: true, rows: 20 };

    expect(effectiveScroll(model, { ...expanded, scroll: -50 })).toBe(-27);
    expect(effectiveScroll(model, { ...expanded, scroll: 3 })).toBe(3);
    expect(effectiveScroll(model, { ...expanded, scroll: 50 })).toBe(7);
  });

  it("absorbs no scroll into a plan column the width hides", () => {
    const model = { ...base, plan: longPlan(40, 30) };
    const narrow = { ...view, columns: 60, expanded: true, rows: 20 };

    expect(effectiveScroll(model, { ...narrow, scroll: 5 })).toBe(0);
    expect(dashboardBody(model, { ...narrow, scroll: 5 })).toEqual(
      dashboardBody(model, { ...narrow, scroll: 0 }),
    );
  });
});

function longPlan(count: number, active: number) {
  const tasks = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1).padStart(2, "0"),
    state: index === active ? ("active" as const) : ("pending" as const),
    title: `Task ${String(index + 1)}`,
  }));
  return { certified: 0, tasks, total: count };
}

describe("dashboard footer", () => {
  it("rules off the dashboard and offers only the production controls", () => {
    const footer = dashboardFooter(base, view);

    expect(footer[0]).toBe("─".repeat(98));
    expect(footer.at(-1)).toBe("m motion · d detail");
    expect(footer.join("\n")).not.toContain("PROTOTYPE");
    expect(footer.join("\n")).not.toContain("step");
    expect(footer.join("\n")).not.toContain("q quit");
  });

  it("offers scrolling only while details are expanded", () => {
    expect(dashboardFooter(base, { ...view, expanded: true }).at(-1)).toBe(
      "m motion · d detail · ↑/↓ scroll",
    );
  });

  it("announces attention above the prompt that follows", () => {
    const footer = dashboardFooter(
      {
        ...base,
        attention: {
          detail: "Should blank answers reprompt?",
          reason: "assumption_needs_decision",
        },
      },
      view,
    );

    expect(footer[1]).toBe("? Should blank answers reprompt?");
  });

  it("summarises a finished run instead of the controls", () => {
    const footer = dashboardFooter({ ...base, finished: "completed" }, view);

    expect(footer.at(-1)).toBe("Run finished · 1 of 3 tasks certified");
  });

  it("reports the export outcome beside the certified count", () => {
    const exported = dashboardFooter(
      {
        ...base,
        export: { head: "a1b2c3d4e5", status: "completed" },
        finished: "completed",
      },
      view,
    );
    const failed = dashboardFooter(
      {
        ...base,
        export: { head: "a1b2c3d4e5", status: "failed" },
        finished: "completed",
      },
      view,
    );

    expect(exported.at(-1)).toBe(
      "Run finished · 1 of 3 tasks certified · exported a1b2c3d",
    );
    expect(failed.at(-1)).toBe(
      "Run finished · 1 of 3 tasks certified · export failed",
    );
  });
});

describe("rendered screen", () => {
  it("fills the screen and never exceeds the visible width", () => {
    const painted = renderDashboard(base, { ...view, columns: 40, rows: 12 });

    expect(painted).toHaveLength(11);
    expect(
      visible(painted).every((line) => Array.from(line).length <= 38),
    ).toBe(true);
  });

  it("keeps the activity lines when the plan outgrows the panel", () => {
    const plan = longPlan(40, 30);
    for (const rows of [16, 20, 24, 40]) {
      const painted = visible(
        renderDashboard({ ...base, plan }, { ...view, rows }),
      );

      expect(painted).toHaveLength(rows - 1);
      expect(painted.join("\n")).toContain("● 31  Task 31");
      expect(painted.join("\n")).toContain("LIVE · Fixing");
      expect(painted.join("\n")).toContain("TOOL · No activity reported");
    }
  });

  it("gives finding items up before the activity lines in a short terminal", () => {
    const findings = {
      headline: "! REVIEW · 3 blocking findings from round 1",
      items: ["  • First", "  • Second", "  • Third"],
      status: "blocking" as const,
    };
    const painted = visible(
      renderDashboard({ ...base, findings }, { ...view, rows: 18 }),
    ).join("\n");

    expect(painted).toContain("! REVIEW · 3 blocking findings from round 1");
    expect(painted).toContain("  • First");
    expect(painted).not.toContain("  • Third");
    expect(painted).toContain("· Completed");
    expect(painted).toContain("LIVE · Fixing");
    expect(painted).toContain("TOOL · No activity reported");
  });

  it("paints the active stage with a shimmer only while motion runs", () => {
    const still = renderDashboard(base, { ...view, motion: false }).join("\n");
    const moving = renderDashboard(base, {
      ...view,
      frame: 6,
      motion: true,
    }).join("\n");

    expect(still).not.toContain(`${escape}[38;5;`);
    expect(moving).toContain(`${escape}[38;5;`);
  });

  it("stops the shimmer when the run needs attention", () => {
    const painted = renderDashboard(
      {
        ...base,
        attention: {
          detail: "Answer required",
          reason: "assumption_needs_decision",
        },
      },
      { ...view, frame: 6, motion: true },
    ).join("\n");

    expect(painted).not.toContain(`${escape}[38;5;`);
  });

  it("paints blocking review lines red and certified lines green", () => {
    const painted = renderDashboard(
      {
        ...base,
        findings: {
          headline: "! REVIEW · 2 blocking findings from round 1",
          items: [],
          status: "blocking",
        },
      },
      view,
    ).join("\n");

    expect(painted).toContain(`${escape}[31m! REVIEW`);
    expect(painted).toContain(`${escape}[31m! Standards review`);
    expect(painted).toContain(`${escape}[32m✓ 01`);
  });
});
