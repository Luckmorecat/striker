import { matchesKey } from "@earendil-works/pi-tui";
import { graphemes } from "./text-cells.js";

/** The answer being typed: its text and a caret index in characters. */
export interface Draft {
  readonly cursor: number;
  readonly text: string;
}

export const emptyDraft: Draft = { cursor: 0, text: "" };

const pasteStart = "[200~";
const pasteEnd = "[201~";

function characters(draft: Draft): readonly string[] {
  return graphemes(draft.text);
}

function at(chars: readonly string[], cursor: number): Draft {
  return {
    cursor: Math.min(Math.max(0, cursor), chars.length),
    text: chars.join(""),
  };
}

function insert(draft: Draft, text: string): Draft {
  const chars = characters(draft);
  const added = graphemes(text);
  return {
    cursor: draft.cursor + added.length,
    text: [
      ...chars.slice(0, draft.cursor),
      ...added,
      ...chars.slice(draft.cursor),
    ].join(""),
  };
}

function remove(draft: Draft, offset: -1 | 0): Draft {
  const chars = characters(draft);
  const index = draft.cursor + offset;
  if (index < 0 || index >= chars.length) return draft;
  return {
    cursor: index,
    text: [...chars.slice(0, index), ...chars.slice(index + 1)].join(""),
  };
}

function lineStart(chars: readonly string[], cursor: number): number {
  let index = cursor;
  while (index > 0 && chars[index - 1] !== "\n") index -= 1;
  return index;
}

function lineEnd(chars: readonly string[], cursor: number): number {
  let index = cursor;
  while (index < chars.length && chars[index] !== "\n") index += 1;
  return index;
}

function moveVertically(draft: Draft, direction: -1 | 1): Draft {
  const chars = characters(draft);
  const start = lineStart(chars, draft.cursor);
  const column = draft.cursor - start;
  if (direction === -1) {
    if (start === 0) return at(chars, 0);
    const previous = lineStart(chars, start - 1);
    return at(chars, Math.min(previous + column, start - 1));
  }
  const end = lineEnd(chars, draft.cursor);
  if (end === chars.length) return at(chars, chars.length);
  return at(chars, Math.min(end + 1 + column, lineEnd(chars, end + 1)));
}

function pastedText(data: string): string | null {
  return data.startsWith(pasteStart) && data.endsWith(pasteEnd)
    ? data.slice(pasteStart.length, -pasteEnd.length)
    : null;
}

/** Literal text the terminal delivered, as opposed to a control sequence. */
function printable(data: string): boolean {
  return data.length > 0 && !/\p{Cc}/u.test(data);
}

/** Keys that move the caret without changing a character of the draft. */
function moveCaret(draft: Draft, data: string): Draft | null {
  const chars = characters(draft);
  if (matchesKey(data, "left")) return at(chars, draft.cursor - 1);
  if (matchesKey(data, "right")) return at(chars, draft.cursor + 1);
  if (matchesKey(data, "up")) return moveVertically(draft, -1);
  if (matchesKey(data, "down")) return moveVertically(draft, 1);
  if (matchesKey(data, "home"))
    return at(chars, lineStart(chars, draft.cursor));
  if (matchesKey(data, "end")) return at(chars, lineEnd(chars, draft.cursor));
  return null;
}

/**
 * Ordinary editing keys only. Submission, cancellation, focus and the shared
 * document's paging keys stay with the dashboard, so `m` and `d` reach the
 * draft as typed characters.
 */
export function editDraft(draft: Draft, data: string): Draft | null {
  const paste = pastedText(data);
  if (paste !== null) return insert(draft, paste);
  if (matchesKey(data, "shift+enter") || matchesKey(data, "alt+enter"))
    return insert(draft, "\n");
  if (matchesKey(data, "backspace")) return remove(draft, -1);
  if (matchesKey(data, "delete")) return remove(draft, 0);
  const moved = moveCaret(draft, data);
  if (moved !== null) return moved;
  return printable(data) ? insert(draft, data) : null;
}
