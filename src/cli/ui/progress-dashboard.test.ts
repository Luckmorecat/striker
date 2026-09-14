import { describe, expect, it } from "vitest";

import { answerHeading, browsingHint, editingHint } from "./answer-block.js";
import { emptyDraft } from "./answer-draft.js";
import {
  dashboardDocument,
  dashboardFooter,
  dashboardWidth,
  renderDashboard,
  type DashboardView,
} from "./progress-dashboard.js";
import type { DashboardModel } from "./progress-model.js";
import { cells } from "./text-cells.js";

const escape = "";
const view: DashboardView = {
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
      { id: "01-create.md", state: "certified", title: "Recovery contracts" },
      { id: "02-answer.md", state: "active", title: "Answer command" },
      { id: "03-handoff.md", state: "pending", title: "Terminal handoff" },
    ],
    total: 3,
  },
  round: 2,
  session: {
    attempt: 1,
    backend: "Docker",
    effort: "high",
    id: "demo-42",
    model: "gpt-5.6-sol",
  },
  stage: "Implementing",
  tool: "No activity reported",
};

const question = "Continue with the available checks, or pause the run?";

function answering(overrides: Partial<DashboardView> = {}): DashboardView {
  return {
    ...view,
    answer: { draft: emptyDraft, editing: false, notice: null, question },
    ...overrides,
  };
}

function visible(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line.replaceAll(new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, "gu"), ""),
  );
}

function index(lines: readonly string[], needle: string): number {
  return lines.findIndex((line) => line.startsWith(needle));
}

describe("layout parity", () => {
  it("orders overview, model context, plan, activity and session", () => {
    const lines = dashboardDocument(base, view);

    expect(lines.slice(0, 5)).toEqual([
      "STRIKER / run overview · 1:12 elapsed",
      "",
      "MODEL gpt-5.6-sol · effort high · Docker · attempt 1",
      "",
      `PLAN / 1 of 3 certified${" ".repeat(49)} │ TASK PIPELINE`,
    ]);
    expect(index(lines, "LIVE · ")).toBeGreaterThan(index(lines, "PLAN /"));
    expect(index(lines, "TOOL · ")).toBe(index(lines, "LIVE · ") + 1);
    // One blank line separates activity from the session identity.
    expect(lines[index(lines, "SESSION ") - 1]).toBe("");
    expect(lines.at(-1)).toBe("SESSION demo-42");
  });

  it("lays the document across the whole terminal, as the reference does", () => {
    for (const columns of [80, 100, 140]) {
      expect(dashboardWidth({ columns })).toBe(columns);
      for (const line of dashboardDocument(base, { ...view, columns }))
        expect(cells(line)).toBeLessThanOrEqual(columns);
    }
  });

  it("keeps a 25-cell pipeline column behind a three-cell rule", () => {
    for (const columns of [80, 100, 140]) {
      const width = dashboardWidth({ columns });
      const row = dashboardDocument(base, { ...view, columns })[4] ?? "";
      const [plan = "", pipeline = ""] = row.split(" │ ");

      expect(cells(plan)).toBe(width - 25 - 3);
      expect(cells(pipeline)).toBeLessThanOrEqual(25);
    }
  });

  it("measures the plan column in terminal cells, not string length", () => {
    const wide = {
      ...base,
      plan: {
        ...base.plan,
        tasks: [{ id: "01", state: "active" as const, title: "設計と実装" }],
      },
    };

    const row = dashboardDocument(wide, view)[7] ?? "";

    expect(row).toContain("設計と実装");
    expect(cells(row.split(" │ ")[0] ?? "")).toBe(dashboardWidth(view) - 28);
  });

  it("marks a fact the backend cannot report instead of inferring it", () => {
    const unknown = {
      ...base,
      session: { ...base.session, effort: null, model: null },
    };

    expect(dashboardDocument(unknown, view)[2]).toBe(
      "MODEL unavailable · effort unavailable · Local".replace(
        "Local",
        "Docker · attempt 1",
      ),
    );
  });
});

describe("plan readability", () => {
  it("puts the whole identity first and indents the title under it", () => {
    const lines = dashboardDocument(base, view).map(
      (line) => line.split(" │ ")[0] ?? "",
    );

    expect(lines[6]?.trimEnd()).toBe("✓ 01-create.md");
    expect(lines[7]?.trimEnd()).toBe("  Recovery contracts");
    expect(lines[8]?.trimEnd()).toBe("● 02-answer.md");
  });

  it("wraps a long identity and title instead of clipping them", () => {
    const long = {
      ...base,
      plan: {
        certified: 0,
        tasks: [
          {
            id: `${"0".repeat(90)}.md`,
            state: "active" as const,
            title:
              "Design responsive layouts and accessible keyboard interactions across every supported viewport",
          },
        ],
        total: 1,
      },
    };

    const plan = dashboardDocument(long, view)
      .map((line) => line.split(" │ ")[0]?.trimEnd() ?? "")
      .filter((line) => line !== "");

    expect(plan.join("")).not.toContain("…");
    expect(plan.join("")).toContain("0".repeat(70));
    expect(plan.filter((line) => line.startsWith("  ")).length).toBeGreaterThan(
      1,
    );
  });

  it("keeps every task in the one document however long the plan is", () => {
    const many = {
      ...base,
      plan: {
        certified: 0,
        tasks: Array.from({ length: 40 }, (_, task) => ({
          id: `task-${String(task).padStart(2, "0")}`,
          state: "pending" as const,
          title: `Task ${String(task)}`,
        })),
        total: 40,
      },
    };

    const lines = dashboardDocument(many, { ...view, rows: 24 });

    expect(lines.some((line) => line.includes("task-39"))).toBe(true);
    expect(lines.some((line) => line.includes("LIVE · "))).toBe(true);
  });
});

describe("activity wrapping", () => {
  const long = { ...base, live: "word ".repeat(200).trim() };

  it("wraps four rows under the label before dropping anything", () => {
    const lines = dashboardDocument(long, view);
    const start = index(lines, "LIVE · ");

    expect(
      lines.slice(start, start + 4).map((line) => line.slice(0, 7)),
    ).toEqual(["LIVE · ", "       ", "       ", "       "]);
    expect(lines[start + 4]).toBe("TOOL · No activity reported");
  });

  it("counts the rows it omitted and offers the key that expands them", () => {
    const lines = dashboardDocument(long, view);
    const fourth = lines[index(lines, "LIVE · ") + 3] ?? "";

    expect(fourth).toMatch(/… \(\+\d+ rows; d expands\)$/u);
    expect(cells(fourth)).toBeLessThanOrEqual(dashboardWidth(view));
  });

  it("expands to a hundred rows and still reports the overflow truthfully", () => {
    const huge = { ...base, live: "word ".repeat(4000).trim() };

    const rows = dashboardDocument(huge, { ...view, expanded: true }).filter(
      (line) => line.startsWith("LIVE · ") || /^ {7}\S/u.test(line),
    );

    expect(rows).toHaveLength(100);
    expect(rows.at(-1)).toMatch(/… \(\+\d+ rows\)$/u);
    expect(rows.at(-1)).not.toContain("d expands");
  });

  it("wraps the tool and session lines to the available width", () => {
    const wordy = {
      ...base,
      session: { ...base.session, id: "striker-".repeat(20) },
      tool: `Inspect browser dependencies · ${"ldd /opt/chromium/chrome ".repeat(6)}`,
    };

    const lines = dashboardDocument(wordy, view);

    expect(lines.filter((line) => line.startsWith("TOOL · "))).toHaveLength(1);
    expect(index(lines, "SESSION ")).toBeLessThan(lines.length - 1);
    for (const line of lines)
      expect(cells(line)).toBeLessThanOrEqual(dashboardWidth(view));
  });
});

describe("answer placement", () => {
  it("appends the block directly after SESSION with one separating gap", () => {
    const lines = dashboardDocument(base, answering());
    const session = index(lines, "SESSION ");

    expect(lines[session + 1]).toBe("");
    expect(lines[session + 2]).toBe("─".repeat(dashboardWidth(view)));
    expect(lines[session + 3]).toBe(answerHeading);
    expect(lines[session + 4]).toBe(question);
    expect(lines[session + 5]).toBe("│ Type your decision…");
    expect(lines.at(-1)).toBe(browsingHint);
  });

  it("shows the paused slot in the pipeline without replacing the screen", () => {
    const paused = {
      ...base,
      attention: { detail: question, reason: "assumption_needs_decision" },
      pipeline: base.pipeline.map((entry) =>
        entry.stage === "Implementing"
          ? { ...entry, note: "needs attention", state: "attention" as const }
          : entry,
      ),
    };

    const lines = dashboardDocument(paused, answering());

    expect(lines.some((line) => line.includes("? Awaiting answer"))).toBe(true);
    expect(lines[0]).toBe("STRIKER / run overview · 1:12 elapsed");
    expect(lines.some((line) => line.startsWith("PLAN / "))).toBe(true);
  });

  it("replaces the footer with the block's own hints and no padding", () => {
    const frame = renderDashboard(base, answering({ rows: 60 }));

    expect(dashboardFooter(base, answering())).toEqual([]);
    expect(visible(frame.lines).at(-1)).toBe(browsingHint);
    // No screen-height padding is reserved before or after the block.
    expect(frame.lines).toHaveLength(
      dashboardDocument(base, answering({ rows: 60 })).length,
    );
  });

  it("paints the whole block as attention, with subordinate hints", () => {
    const painted = renderDashboard(base, answering()).lines;
    const find = (needle: string) =>
      painted.find((line) => line.includes(needle)) ?? "";

    expect(find("─────")).toContain(`${escape}[33m`);
    expect(find(answerHeading)).toContain(`${escape}[33m`);
    expect(find(question)).toContain(`${escape}[33m`);
    // The operator's own text is theirs, and the hints stay subordinate.
    expect(find("Type your decision")).toContain(`${escape}[0m│`);
    expect(painted.at(-1)).toContain(`${escape}[90m`);
  });

  it("names the keys it actually supports in each mode", () => {
    const editing = dashboardDocument(
      base,
      answering({
        answer: { draft: emptyDraft, editing: true, notice: null, question },
      }),
    );

    expect(editing.at(-1)).toBe(editingHint);
    expect(editingHint).toContain("Esc browse");
    expect(editingHint).toContain("Ctrl-C/D leave paused");
    expect(browsingHint).toContain("Tab answer");
    // Both hints have to survive the narrowest reference terminal.
    for (const hint of [editingHint, browsingHint])
      expect(cells(hint)).toBeLessThanOrEqual(80);
  });
});

describe("one universal scroll", () => {
  const wall = Array.from(
    { length: 60 },
    (_, line) =>
      `Paragraph ${String(line)} of a question that outruns the screen.`,
  ).join("\n");
  const tall = answering({
    answer: { draft: emptyDraft, editing: false, notice: null, question: wall },
    rows: 24,
  });

  it("never caps or clips the question, however long it is", () => {
    const lines = dashboardDocument(base, tall);

    const paragraphs = lines.filter((line) => line.startsWith("Paragraph "));

    expect(paragraphs).toHaveLength(60);
    expect(paragraphs.some((line) => line.endsWith("…"))).toBe(false);
  });

  it("pushes the editor below the fold and reaches it by scrolling", () => {
    const first = renderDashboard(base, tall);
    expect(visible(first.lines).some((line) => line.startsWith("│ "))).toBe(
      false,
    );

    const end = renderDashboard(base, { ...tall, scroll: 500 });
    expect(visible(end.lines).at(-1)).toBe(browsingHint);

    // and back to the plan, through the same offset
    const back = renderDashboard(base, { ...tall, scroll: 0 });
    expect(visible(back.lines)[0]).toBe(
      "STRIKER / run overview · 1:12 elapsed",
    );
  });

  it("reports the scroll it honoured so the keys never go dead", () => {
    expect(renderDashboard(base, { ...tall, scroll: 9_000 }).scroll).toBe(
      dashboardDocument(base, tall).length - 24,
    );
    expect(renderDashboard(base, { ...tall, scroll: -5 }).scroll).toBe(0);
  });

  it("reveals the caret only when the operator asked for it", () => {
    const editing = {
      ...tall,
      answer: {
        draft: emptyDraft,
        editing: true,
        notice: null,
        question: wall,
      },
    };

    expect(renderDashboard(base, editing).caret).toBeNull();

    const followed = renderDashboard(base, { ...editing, follow: true });
    expect(followed.caret).not.toBeNull();
    expect(followed.scroll).toBeGreaterThan(0);
    expect(visible(followed.lines)[followed.caret?.row ?? -1]).toBe(
      "│ Type your decision…",
    );
    expect(followed.caret?.column).toBe(2);
  });

  it("does not require expanding activity before the answer scrolls", () => {
    const scrolled = renderDashboard(base, { ...tall, scroll: 4 });

    expect(scrolled.scroll).toBe(4);
    expect(scrolled.viewport).toBe(24);
  });
});

describe("boundaries", () => {
  it("keeps the compact pipeline fallback below the two-column width", () => {
    const lines = dashboardDocument(base, { ...view, columns: 60 });

    expect(lines[4]).toBe("TASK PIPELINE");
    expect(lines.some((line) => line.includes(" │ "))).toBe(false);
    expect(lines.some((line) => line.startsWith("SESSION "))).toBe(true);
  });

  it("renders a usable frame at the smallest terminal it will meet", () => {
    const frame = renderDashboard(base, {
      ...answering(),
      columns: 1,
      rows: 1,
    });

    expect(frame.lines).toHaveLength(1);
    expect(cells(visible(frame.lines)[0] ?? "")).toBeLessThanOrEqual(20);
  });

  it("hard-breaks an unbroken token rather than losing it", () => {
    const token = { ...base, live: "x".repeat(400) };

    const rows = visible(dashboardDocument(token, view)).filter(
      (line) => line.startsWith("LIVE · ") || /^ {7}x/u.test(line),
    );

    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe(`LIVE · ${"x".repeat(93)}`);
  });
});

describe("retained run facts", () => {
  it("shows findings above the activity lines", () => {
    const blocked = {
      ...base,
      findings: {
        headline: "! REVIEW · 2 blocking findings from round 1",
        items: ["  • First finding", "  • Second finding"],
        status: "blocking" as const,
      },
    };

    const lines = dashboardDocument(blocked, view);

    expect(lines[index(lines, "LIVE · ") - 3]).toBe(
      "! REVIEW · 2 blocking findings from round 1",
    );
    expect(lines[index(lines, "LIVE · ") - 1]).toBe("  • Second finding");
  });

  it("rules off the dashboard and offers the production controls", () => {
    expect(dashboardFooter(base, view)).toEqual([
      "─".repeat(100),
      "m motion · d expands live · ↑/↓ scroll · PgUp/PgDn page",
    ]);
  });

  it("summarises a finished run with its export outcome", () => {
    const finished = {
      ...base,
      export: { head: "abcdef1234", status: "completed" as const },
      finished: "completed" as const,
    };

    expect(dashboardFooter(finished, view).at(-1)).toBe(
      "Run finished · 1 of 3 tasks certified · exported abcdef1",
    );
  });

  it("announces attention above the prompt that follows", () => {
    const paused = {
      ...base,
      attention: { detail: question, reason: "assumption_needs_decision" },
    };

    expect(dashboardFooter(paused, view)[1]).toBe(`? ${question}`);
  });

  it("colours a plan task by its own state, not the stage sharing its row", () => {
    const frame = renderDashboard(base, { ...view, rows: 40 });
    const row = frame.lines.find((line) => line.includes("Recovery contracts"));

    expect(row).toContain(`${escape}[0m  Recovery contracts`);
    expect(row).toContain(`${escape}[36m● Implementing`);
  });

  it("shimmers the active stage only while motion runs", () => {
    const still = renderDashboard(base, view).lines.join("\n");
    const moving = renderDashboard(base, {
      ...view,
      frame: 7,
      motion: true,
    }).lines.join("\n");

    expect(still).not.toContain("38;5;");
    expect(moving).toContain("38;5;");
  });
});
