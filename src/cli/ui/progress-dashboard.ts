import type { DashboardModel, PlanTaskLine } from "./progress-model.js";
import { clip, clock, pad, paintLine } from "./progress-paint.js";
import type { PipelineStage, StageState } from "./progress-stages.js";

export interface DashboardView {
  readonly columns: number;
  readonly elapsedSeconds: number;
  readonly expanded: boolean;
  readonly frame: number;
  readonly motion: boolean;
  readonly rows: number;
  readonly scroll: number;
}

const stageSymbols: Readonly<Record<StageState, string>> = {
  active: "●",
  attention: "?",
  blocked: "!",
  passed: "✓",
  pending: "·",
  recheck: "↻",
};
const taskSymbols = { active: "●", certified: "✓", pending: "·" };
const leftWidth = 32;
const separator = " │ ";
/** Title and blank line above the columns. */
const headerLines = 2;
/** PLAN heading, its blank line, and the blank, SESSION and Attempt lines. */
const planFramingLines = 5;

export function dashboardWidth(view: DashboardView): number {
  return Math.max(20, view.columns - 2);
}

function stageLine(entry: PipelineStage): string {
  return `${stageSymbols[entry.state]} ${entry.stage}${entry.note === null ? "" : ` · ${entry.note}`}`;
}

export function activeStageLabel(model: DashboardModel): string | null {
  const active = model.pipeline.find((entry) => entry.state === "active");
  return active === undefined ? null : `● ${active.stage}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(low, value), high);
}

/**
 * Q7: the selected task stays on screen however long the plan is, and
 * scrolling moves the window from there. Scroll the window cannot absorb is
 * returned for the body.
 */
function windowTasks(
  tasks: readonly PlanTaskLine[],
  capacity: number,
  scroll: number,
): { readonly remaining: number; readonly tasks: readonly PlanTaskLine[] } {
  if (tasks.length <= capacity) return { remaining: scroll, tasks };
  const active = Math.max(
    0,
    tasks.findIndex((task) => task.state === "active"),
  );
  const last = tasks.length - capacity;
  const centred = clamp(active - Math.floor(capacity / 2), 0, last);
  const start = clamp(centred + scroll, 0, last);
  return {
    remaining: scroll - (start - centred),
    tasks: tasks.slice(start, start + capacity),
  };
}

function planPanel(
  model: DashboardModel,
  capacity: number,
  scroll: number,
): { readonly lines: readonly string[]; readonly remaining: number } {
  const { certified, tasks, total } = model.plan;
  const window = windowTasks(tasks, Math.max(1, capacity), scroll);
  return {
    lines: [
      `PLAN / ${String(certified)}${total === null ? "" : ` of ${String(total)}`} certified`,
      "",
      ...window.tasks.map((task) =>
        `${taskSymbols[task.state]} ${task.id}  ${task.title}`.trimEnd(),
      ),
      "",
      `SESSION ${model.session.id ?? "pending"}`,
      `Attempt ${String(model.session.attempt)} · ${model.session.backend}`,
    ],
    remaining: window.remaining,
  };
}

function columnise(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return Array.from(
    { length: Math.max(left.length, right.length) },
    (_, index) =>
      `${pad(left[index] ?? "", leftWidth)}${separator}${right[index] ?? ""}`,
  );
}

function activityLines(
  model: DashboardModel,
  view: DashboardView,
  droppedFindings: number,
): readonly string[] {
  const { findings } = model;
  return [
    "",
    ...(findings === null
      ? []
      : [
          findings.headline,
          ...findings.items.slice(0, findings.items.length - droppedFindings),
        ]),
    `LIVE · ${model.live}`,
    `TOOL · ${model.tool}`,
    ...(view.expanded ? [model.detail] : []),
  ];
}

/** Rows left for the body once the footer and the prompt row are placed. */
function bodyRoom(model: DashboardModel, view: DashboardView): number {
  return Math.max(1, view.rows - dashboardFooter(model, view).length - 1);
}

interface Layout {
  /** Scroll the plan window took, so the session can keep what was honoured. */
  readonly absorbed: number;
  readonly lines: readonly string[];
  /** Scroll left over to offset the body. */
  readonly remaining: number;
}

function compose(
  model: DashboardModel,
  view: DashboardView,
  droppedFindings: number,
): Layout {
  const width = dashboardWidth(view);
  const wide = width >= 76;
  const pipeline = ["TASK PIPELINE", "", ...model.pipeline.map(stageLine)];
  const activity = activityLines(model, view, droppedFindings);
  // The task window takes whatever the fixed lines leave, so LIVE and TOOL
  // stay on screen whenever those fixed lines fit at all.
  const capacity =
    bodyRoom(model, view) - headerLines - planFramingLines - activity.length;
  // A plan column the width hides absorbs no scroll.
  const panel = planPanel(model, capacity, wide ? view.scroll : 0);
  return {
    absorbed: wide ? view.scroll - panel.remaining : 0,
    lines: [
      `STRIKER / run overview · ${clock(view.elapsedSeconds)} elapsed`,
      "",
      ...(wide ? columnise(panel.lines, pipeline) : pipeline),
      ...activity,
    ].map((line) => clip(line, width)),
    remaining: wide ? panel.remaining : view.scroll,
  };
}

/** Finding items give way before the activity lines; the headline keeps the count. */
function layout(model: DashboardModel, view: DashboardView): Layout {
  const full = compose(model, view, 0);
  const overflow = full.lines.length - bodyRoom(model, view);
  const items = model.findings?.items.length ?? 0;
  return overflow > 0 && items > 0
    ? compose(model, view, Math.min(items, overflow))
    : full;
}

/** The scroll a frame can honour; storing it keeps the arrows responsive. */
export function effectiveScroll(
  model: DashboardModel,
  view: DashboardView,
): number {
  const { absorbed, lines, remaining } = layout(model, view);
  const overflow = Math.max(0, lines.length - bodyRoom(model, view));
  return absorbed + clamp(remaining, 0, overflow);
}

export function dashboardBody(
  model: DashboardModel,
  view: DashboardView,
): readonly string[] {
  return layout(model, view).lines;
}

function exportSummary(model: DashboardModel): string {
  const state = model.export;
  if (state === null) return "";
  return state.status === "failed"
    ? " · export failed"
    : ` · exported ${state.head.slice(0, 7)}`;
}

/** Counted display facts only; the command prints its own result message. */
function finishedSummary(model: DashboardModel): string {
  const { certified, total } = model.plan;
  const counted = `${String(certified)}${total === null ? "" : ` of ${String(total)}`} tasks certified`;
  return `Run finished · ${counted}${exportSummary(model)}`;
}

export function dashboardFooter(
  model: DashboardModel,
  view: DashboardView,
): readonly string[] {
  const width = dashboardWidth(view);
  return [
    "─".repeat(width),
    ...(model.attention === null ? [] : [`? ${model.attention.detail}`]),
    model.finished === null
      ? `m motion · d detail${view.expanded ? " · ↑/↓ scroll" : ""}`
      : finishedSummary(model),
  ].map((line) => clip(line, width));
}

export function renderDashboard(
  model: DashboardModel,
  view: DashboardView,
  mode: "block" | "screen" = "screen",
): readonly string[] {
  const footer = dashboardFooter(model, view);
  const { lines: body, remaining } = layout(model, view);
  const room = bodyRoom(model, view);
  const offset = clamp(remaining, 0, Math.max(0, body.length - room));
  const visible = body.slice(offset, offset + room);
  const shimmerLabel =
    view.motion && model.attention === null && model.finished === null
      ? activeStageLabel(model)
      : null;
  return [
    ...visible,
    // Block mode leaves room for a prompt directly below the retained dashboard.
    ...(mode === "screen"
      ? Array<string>(Math.max(0, room - visible.length)).fill("")
      : []),
    ...footer,
  ].map((line) => paintLine(line, { frame: view.frame, shimmerLabel }));
}
