import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Terminal geometry is counted in character cells, never in JavaScript string
 * length: a combining mark costs nothing and an East Asian glyph costs two.
 */
const segmenter = new Intl.Segmenter();

interface Cluster {
  readonly text: string;
  readonly width: number;
}

export function cells(text: string): number {
  return visibleWidth(text);
}

/** Whole user-perceived characters: what a caret and a backspace move over. */
export function graphemes(text: string): readonly string[] {
  return Array.from(segmenter.segment(text), (entry) => entry.segment);
}

function clusters(text: string): readonly Cluster[] {
  return graphemes(text).map((character) => ({
    text: character,
    width: visibleWidth(character),
  }));
}

/** The longest prefix of `text` that fits `width` cells, in whole clusters. */
export function take(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  let taken = "";
  let used = 0;
  for (const cluster of clusters(text)) {
    if (used + cluster.width > width) break;
    taken += cluster.text;
    used += cluster.width;
  }
  return taken;
}

export function clip(text: string, width: number): string {
  const room = Math.max(0, width);
  if (visibleWidth(text) <= room) return text;
  return room === 0 ? "" : `${take(text, room - 1)}…`;
}

export function pad(text: string, width: number): string {
  const clipped = clip(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Cluster index just past the cells that fit; at least one, so wrapping ends. */
function hardBreak(list: readonly Cluster[], width: number): number {
  let used = 0;
  let index = 0;
  for (const cluster of list) {
    if (used + cluster.width > width) break;
    used += cluster.width;
    index += 1;
  }
  return Math.max(1, index);
}

function lastSpace(list: readonly Cluster[], limit: number): number {
  for (let index = limit; index > 0; index -= 1)
    if (list[index]?.text === " ") return index;
  return -1;
}

function join(list: readonly Cluster[]): string {
  return list.map((cluster) => cluster.text).join("");
}

function widthOf(list: readonly Cluster[], count: number): number {
  let total = 0;
  for (let index = 0; index < count; index += 1)
    total += list[index]?.width ?? 0;
  return total;
}

/** A wrapped row and the characters it consumed, break whitespace included. */
export interface Segment {
  readonly characters: number;
  readonly text: string;
}

function segment(list: readonly Cluster[], consumed: number): Segment {
  return { characters: list.length + consumed, text: join(list) };
}

/**
 * The reference's wrap: break after the last space that fits, but hard-break an
 * unbroken token rather than leaving a stub shorter than a third of the width.
 * Each row reports its source length so a caret can be placed inside it.
 */
export function wrapSegments(text: string, width: number): readonly Segment[] {
  const room = Math.max(1, width);
  const rows: Segment[] = [];
  let rest = clusters(text);
  let total = widthOf(rest, rest.length);
  while (total > room) {
    const hard = hardBreak(rest, room);
    const space = lastSpace(rest, Math.min(hard, rest.length - 1));
    const cut = space > 0 && widthOf(rest, space) * 3 >= room ? space : hard;
    let drop = cut;
    while (rest[drop]?.text === " ") drop += 1;
    rows.push(segment(rest.slice(0, cut), drop - cut));
    total -= widthOf(rest, drop);
    rest = rest.slice(drop);
  }
  rows.push(segment(rest, 0));
  return rows;
}

export function wrap(text: string, width: number): readonly string[] {
  return wrapSegments(text, width).map((row) => row.text);
}

/** Wraps text that already carries its own line breaks. */
export function wrapAll(text: string, width: number): readonly string[] {
  return text.split("\n").flatMap((line) => wrap(line, width));
}
