import { answerRows, type AnswerBlock, type Caret } from "./answer-block.js";
import type { DashboardModel, PlanTaskLine } from "./progress-model.js";
import {
  activityIndent,
  clock,
  columnSeparator,
  paintLine,
  type Tone,
} from "./progress-paint.js";
import type { PipelineStage, StageState } from "./progress-stages.js";
import { cells, clip, pad, take, wrap } from "./text-cells.js";

export interface DashboardView {
  /** Present while the run is paused for an answer, appended after SESSION. */
  readonly answer?: AnswerBlock;
  readonly columns: number;
  readonly elapsedSeconds: number;
  readonly expanded: boolean;
  /** Keep the caret on screen; browsing leaves a reader where they are. */
  readonly follow?: boolean;
  readonly frame: number;
  readonly motion: boolean;
  readonly rows: number;
  readonly scroll: number;
}

export interface DashboardFrame {
  /** Screen position of the answer caret, absent when it is off screen. */
  readonly caret: Caret | null;
  readonly lines: readonly string[];
  /** The scroll this frame honoured, so overshooting never deadens the keys. */
  readonly scroll: number;
  /** Document rows the body showed, which is what a page key moves by. */
  readonly viewport: number;
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
/** The reference's fixed pipeline column and the rule between the columns. */
const pipelineWidth = 25;
/** Below this usable width the plan column is dropped, as it always was. */
const compactWidth = 76;
const liveLabel = "LIVE · ";

const liveRowLimits = { collapsed: 4, expanded: 100 };
const awaitingAnswer = "? Awaiting answer";
const unavailable = "unavailable";
const controlHint = "m motion · d expands live · ↑/↓ scroll · PgUp/PgDn page";
const titleIndent = "  ";

/**
 * The reference lays out across the whole terminal, so production does too. A
 * full-width row leaves the cursor in the deferred-wrap state; the carriage
 * return that ends every painted row clears it, so no row wraps twice.
 */
export function dashboardWidth(view: { readonly columns: number }): number {
  return Math.max(20, view.columns);
}

/** Everything the pipeline column and its rule do not take. */
function planWidth(width: number): number {
  return Math.max(12, width - pipelineWidth - columnSeparator.length);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(low, value), high);
}

/** The column is fixed, so a long note wraps under its stage instead of going. */
function stageRows(
  entry: PipelineStage,
  answering: boolean,
): readonly string[] {
  if (answering && (entry.state === "attention" || entry.state === "active"))
    return [awaitingAnswer];
  const head = `${stageSymbols[entry.state]} ${entry.stage}`;
  if (entry.note === null) return wrap(head, pipelineWidth);
  const line = `${head} · ${entry.note}`;
  if (cells(line) <= pipelineWidth) return [line];
  return [
    ...wrap(head, pipelineWidth),
    ...wrap(`· ${entry.note}`, pipelineWidth - titleIndent.length).map(
      (note) => `${titleIndent}${note}`,
    ),
  ];
}

export function activeStageLabel(model: DashboardModel): string | null {
  const active = model.pipeline.find((entry) => entry.state === "active");
  return active === undefined ? null : `● ${active.stage}`;
}

/**
 * Agent narration wraps under its own label before anything is dropped, and
 * the row that is cut says how many rows it stands for.
 */
function liveRows(
  text: string,
  width: number,
  expanded: boolean,
): readonly string[] {
  const limit = expanded ? liveRowLimits.expanded : liveRowLimits.collapsed;
  const all = wrap(text, Math.max(1, width - liveLabel.length));
  const visible = [...all.slice(0, limit)];
  const omitted = all.length - limit;
  if (omitted > 0) {
    const suffix = `… (+${String(omitted)} rows${expanded ? "" : "; d expands"})`;
    const room = Math.max(0, width - 1 - liveLabel.length - cells(suffix));
    visible[limit - 1] = take(visible[limit - 1] ?? "", room) + suffix;
  }
  return visible.map(
    (line, index) => (index === 0 ? liveLabel : activityIndent) + line,
  );
}

/** The marker and whole identity first; the title wraps underneath it. */
function taskRows(task: PlanTaskLine, width: number): readonly string[] {
  const title = task.title.trim();
  return [
    ...wrap(`${taskSymbols[task.state]} ${task.id}`, width),
    ...(title === ""
      ? []
      : wrap(title, Math.max(1, width - titleIndent.length)).map(
          (line) => `${titleIndent}${line}`,
        )),
  ];
}

function columnise(
  left: readonly string[],
  right: readonly string[],
  width: number,
): readonly string[] {
  return Array.from(
    { length: Math.max(left.length, right.length) },
    (_, index) =>
      `${pad(left[index] ?? "", width)}${columnSeparator}${right[index] ?? ""}`,
  );
}

/** The facts this run is executing under; never a current-default stand-in. */
function contextLine(model: DashboardModel): string {
  const { attempt, backend, effort, model: name } = model.session;
  return `MODEL ${name ?? unavailable} · effort ${effort ?? unavailable} · ${backend} · attempt ${String(attempt)}`;
}

function planRows(model: DashboardModel, width: number): readonly string[] {
  const { certified, tasks, total } = model.plan;
  const counted = total === null ? "" : ` of ${String(total)}`;
  return [
    `PLAN / ${String(certified)}${counted} certified`,
    "",
    ...tasks.flatMap((task) => taskRows(task, width)),
  ];
}

function findingRows(model: DashboardModel): readonly string[] {
  const { findings } = model;
  return findings === null ? [] : [findings.headline, ...findings.items];
}

interface Document {
  /** Caret position within the document, before any scrolling is applied. */
  readonly caret: Caret | null;
  readonly lines: readonly string[];
  /** Set only where the layout, not the text, decides a row's colour. */
  readonly tones: readonly (Tone | null)[];
}

/**
 * One continuous document: overview, model context, plan beside the pipeline,
 * activity, session and — while the run is paused — the whole question, the
 * draft and the hints. Nothing here is a viewport of its own.
 */
function documentOf(model: DashboardModel, view: DashboardView): Document {
  const width = dashboardWidth(view);
  const left = planWidth(width);
  const answering = view.answer !== undefined;
  const pipeline = [
    "TASK PIPELINE",
    "",
    ...model.pipeline.flatMap((entry) => stageRows(entry, answering)),
  ];
  const body = [
    `STRIKER / run overview · ${clock(view.elapsedSeconds)} elapsed`,
    "",
    contextLine(model),
    "",
    ...(width >= compactWidth
      ? columnise(planRows(model, left), pipeline, left)
      : pipeline),
    "",
    ...findingRows(model),
    ...liveRows(model.live, width, view.expanded),
    ...wrap(`TOOL · ${model.tool}`, width),
    ...(view.expanded ? [model.detail] : []),
    "",
    ...wrap(`SESSION ${model.session.id ?? "pending"}`, width),
  ];
  const answer =
    view.answer === undefined ? null : answerRows(view.answer, width);
  return {
    caret:
      answer?.caret == null
        ? null
        : { column: answer.caret.column, row: body.length + answer.caret.row },
    lines: [...body, ...(answer?.lines ?? [])].map((line) => clip(line, width)),
    tones: [...body.map(() => null), ...(answer?.tones ?? [])],
  };
}

export function dashboardDocument(
  model: DashboardModel,
  view: DashboardView,
): readonly string[] {
  return documentOf(model, view).lines;
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

/** The answer block carries its own hints, so it replaces the footer. */
export function dashboardFooter(
  model: DashboardModel,
  view: DashboardView,
): readonly string[] {
  if (view.answer !== undefined) return [];
  const width = dashboardWidth(view);
  return [
    "─".repeat(width),
    ...(model.attention === null ? [] : [`? ${model.attention.detail}`]),
    model.finished === null ? controlHint : finishedSummary(model),
  ].map((line) => clip(line, width));
}

/**
 * The offset this frame honours: never past the end, and — only when the
 * operator asked for the caret — far enough to show it, and no further.
 */
function offsetOf(
  document: Document,
  view: DashboardView,
  viewport: number,
): number {
  const limit = Math.max(0, document.lines.length - viewport);
  const requested = clamp(view.scroll, 0, limit);
  const caret = document.caret;
  if (view.follow !== true || caret === null) return requested;
  if (caret.row < requested) return caret.row;
  return caret.row >= requested + viewport
    ? Math.min(caret.row - viewport + 1, limit)
    : requested;
}

function onScreen(
  document: Document,
  scroll: number,
  viewport: number,
): Caret | null {
  const caret = document.caret;
  if (caret === null) return null;
  const row = caret.row - scroll;
  return row >= 0 && row < viewport ? { column: caret.column, row } : null;
}

export function renderDashboard(
  model: DashboardModel,
  view: DashboardView,
  mode: "block" | "screen" = "screen",
): DashboardFrame {
  const document = documentOf(model, view);
  const footer = dashboardFooter(model, view);
  const viewport = Math.max(1, view.rows - footer.length);
  const scroll = offsetOf(document, view, viewport);
  const visible = document.lines.slice(scroll, scroll + viewport);
  const shimmerLabel =
    view.motion && model.attention === null && model.finished === null
      ? activeStageLabel(model)
      : null;
  return {
    caret: onScreen(document, scroll, viewport),
    lines: [
      ...visible.map((line, index) => ({
        line,
        tone: document.tones[scroll + index] ?? null,
      })),
      // Block mode leaves room for a prompt below, and the answer block needs
      // no reserved height: the reference puts it straight after SESSION.
      ...(mode === "screen" && view.answer === undefined
        ? Array<string>(Math.max(0, viewport - visible.length)).fill("")
        : []
      ).map((line) => ({ line, tone: null })),
      ...footer.map((line) => ({ line, tone: null })),
    ].map(({ line, tone }) =>
      paintLine(line, { frame: view.frame, shimmerLabel, tone }),
    ),
    scroll,
    viewport,
  };
}
