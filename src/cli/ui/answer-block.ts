import type { Draft } from "./answer-draft.js";
import type { Tone } from "./progress-paint.js";
import { cells, graphemes, wrapAll, wrapSegments } from "./text-cells.js";

/** The paused run's question and the answer being composed below it. */
export interface AnswerBlock {
  readonly draft: Draft;
  readonly editing: boolean;
  /** A rejection the operator has to see, such as a blank submission. */
  readonly notice: string | null;
  readonly question: string;
}

export interface Caret {
  readonly column: number;
  readonly row: number;
}

export interface AnswerRows {
  /** Caret offset inside the block, present only while the draft has focus. */
  readonly caret: Caret | null;
  readonly lines: readonly string[];
  /** One tone per line: the reference colours the whole block, not its heading. */
  readonly tones: readonly Tone[];
}

export const answerHeading = "? ANSWER NEEDED · run paused";
export const browsingHint =
  "Tab answer · ↑/↓ scroll · PgUp/PgDn page · d expands live · m motion";
export const editingHint =
  "Enter submit · Shift/Alt+Enter newline · Esc browse · Ctrl-C/D leave paused";
export const blankNotice = "Answer cannot be blank. Enter a decision.";
const placeholder = "Type your decision…";
const gutter = "│ ";
/** Cells the gutter spends before the draft text starts. */
const gutterWidth = 2;
/** Heading and separator; the leading gap is counted by the caller. */
const headingRows = 2;

function draftRows(
  draft: Draft,
  width: number,
): { readonly caret: Caret; readonly lines: readonly string[] } {
  const room = Math.max(1, width - gutterWidth);
  const lines: string[] = [];
  let caret: Caret = { column: gutterWidth, row: 0 };
  let offset = 0;
  draft.text.split("\n").forEach((logical, index) => {
    if (index > 0) offset += 1;
    for (const row of wrapSegments(logical, room)) {
      if (draft.cursor >= offset) {
        const characters = graphemes(row.text);
        const within = Math.min(draft.cursor - offset, characters.length);
        caret = {
          column: gutterWidth + cells(characters.slice(0, within).join("")),
          row: lines.length,
        };
      }
      lines.push(gutter + row.text);
      offset += row.characters;
    }
  });
  return {
    caret,
    lines: draft.text === "" ? [`${gutter}${placeholder}`] : lines,
  };
}

function toned(lines: readonly string[], tone: Tone) {
  return lines.map((line) => ({ line, tone }));
}

/**
 * The block the reference appends after SESSION: one separating gap, a modest
 * rule, the heading, the whole question, the growing draft and the hints. It is
 * plain document text, so the one dashboard scroll reaches every line of it.
 */
export function answerRows(block: AnswerBlock, width: number): AnswerRows {
  const room = Math.max(1, width);
  const question = wrapAll(block.question, Math.max(1, room - 4));
  const draft = draftRows(block.draft, room);
  const notice = block.notice === null ? [] : wrapAll(block.notice, room);
  const rows = [
    ...toned(["", "─".repeat(room), answerHeading, ...question], "attention"),
    // The draft is the operator's own text, in the terminal's own colour.
    ...toned(draft.lines, "plain"),
    ...toned(notice, "attention"),
    ...toned([block.editing ? editingHint : browsingHint], "hint"),
  ];
  return {
    caret: block.editing
      ? {
          column: draft.caret.column,
          row: 1 + headingRows + question.length + draft.caret.row,
        }
      : null,
    lines: rows.map((row) => row.line),
    tones: rows.map((row) => row.tone),
  };
}
