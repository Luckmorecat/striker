const escape = "\u001B";
const stageMarkers =
  "REVIEW|Preparing|Implementing|Verifying|Standards review|Plan review|Completed";

export function clip(text: string, width: number): string {
  const characters = Array.from(text);
  return characters.length > width
    ? `${characters.slice(0, Math.max(0, width - 1)).join("")}…`
    : text;
}

export function pad(text: string, width: number): string {
  return clip(text, width).padEnd(width);
}

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

function lineColor(line: string): string {
  // Attention is painted where it is addressed to the developer: the footer
  // question and the answer prompt. A pipeline note inside a columnised row
  // keeps the row's own colour, as the visual reference did.
  if (/^\?|^ANSWER/u.test(line)) return "33";
  return /●|LIVE/u.test(line) ? "36" : "0";
}

export interface PaintOptions {
  readonly frame: number;
  /** The active stage label, present only while its shimmer should move. */
  readonly shimmerLabel: string | null;
}

export function paintLine(line: string, options: PaintOptions): string {
  const color = lineColor(line);
  const moved =
    options.shimmerLabel === null
      ? line
      : shimmer(line, options.shimmerLabel, options.frame, color);
  const painted = moved
    .replace(
      new RegExp(`! (?:${stageMarkers})`, "u"),
      (text) => `${escape}[31m${text}`,
    )
    .replaceAll(
      /✓[^│]*/gu,
      (text) => `${escape}[32m${text}${escape}[${color}m`,
    );
  return `${escape}[${color}m${painted}${escape}[0m`;
}
