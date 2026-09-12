const escape = "\u001B";
const stageMarkers =
  "REVIEW|Preparing|Implementing|Verifying|Standards review|Plan review|Completed";

export function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Paint after clipping so escape sequences never count as visible columns. */
export function shimmer(
  line: string,
  label: string,
  frame: number,
  baseColor: string,
): string {
  const start = line.indexOf(label);
  if (start < 0) return line;
  const characters = Array.from(label);
  const center = ((frame * 0.35) % (characters.length + 12)) - 6;
  const painted = characters
    .map((character, index) => {
      const distance = Math.abs(index - center);
      const shade =
        distance < 1 ? 231 : distance < 2 ? 195 : distance < 3 ? 153 : 67;
      return `${escape}[38;5;${String(shade)}m${character}`;
    })
    .join("");
  return `${line.slice(0, start)}${painted}${escape}[${baseColor}m${line.slice(start + label.length)}`;
}

/** Wrapped activity sits under its label, and keeps the label's colour. */
export const activityIndent = "       ";

/**
 * Rows whose colour is a layout fact rather than a property of their text:
 * the paused run's question is addressed to the developer, and its key hints
 * are subordinate to it.
 */
export type Tone = "attention" | "hint" | "plain";

const tones: Readonly<Record<Tone, string>> = {
  attention: "33",
  hint: "90",
  plain: "0",
};

function lineColor(line: string, tone: Tone | null): string {
  if (tone !== null) return tones[tone];
  // Attention is painted where it is addressed to the developer: the footer
  // question and the answer heading. A pipeline note inside a columnised row
  // keeps the row's own colour, as the visual reference did.
  if (/^\?|^ANSWER/u.test(line)) return tones.attention;
  if (line.startsWith(activityIndent) && line.trim() !== "") return "36";
  return /●|LIVE/u.test(line) ? "36" : tones.plain;
}

export interface PaintOptions {
  readonly frame: number;
  /** The active stage label, present only while its shimmer should move. */
  readonly shimmerLabel: string | null;
  /** Set where the layout, not the text, decides the row's colour. */
  readonly tone?: Tone | null;
}

/** The two-column separator; each column is coloured on its own. */
export const columnSeparator = " │ ";

function paintSegment(segment: string, options: PaintOptions): string {
  const color = lineColor(segment, options.tone ?? null);
  const moved =
    options.shimmerLabel === null
      ? segment
      : shimmer(segment, options.shimmerLabel, options.frame, color);
  const painted = moved
    .replace(
      new RegExp(`! (?:${stageMarkers})`, "u"),
      (text) => `${escape}[31m${text}`,
    )
    .replaceAll(/✓.*/gu, (text) => `${escape}[32m${text}${escape}[${color}m`);
  return `${escape}[${color}m${painted}${escape}[0m`;
}

/**
 * A columnised row carries a plan task and a pipeline stage that have nothing
 * to do with each other, so each column decides its own colour: a pending task
 * is not "active" because the active stage happens to sit on its row.
 */
export function paintLine(line: string, options: PaintOptions): string {
  return line
    .split(columnSeparator)
    .map((segment) => paintSegment(segment, options))
    .join(columnSeparator);
}
