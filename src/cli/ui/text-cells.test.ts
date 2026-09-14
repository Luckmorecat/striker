import { describe, expect, it } from "vitest";

import {
  cells,
  clip,
  graphemes,
  pad,
  wrap,
  wrapSegments,
} from "./text-cells.js";

describe("terminal cells", () => {
  it("counts what the terminal draws, not what the string holds", () => {
    expect(cells("設計")).toBe(4);
    expect(cells("é")).toBe(1);
    expect(cells("👩‍💻")).toBe(2);
  });

  it("pads and clips to real cells", () => {
    expect(pad("設計", 6)).toBe("設計  ");
    expect(cells(pad("👩‍💻ok", 9))).toBe(9);
    expect(clip("設計と実装", 6)).toBe("設計…");
    expect(cells(clip("設計と実装", 6))).toBeLessThanOrEqual(6);
  });

  it("never produces a negative or empty-forever width", () => {
    expect(pad("anything", -4)).toBe("");
    expect(clip("anything", 0)).toBe("");
    expect(wrap("anything", 0)).toEqual([
      "a",
      "n",
      "y",
      "t",
      "h",
      "i",
      "n",
      "g",
    ]);
    // A glyph wider than the room still advances, one row at a time.
    expect(wrap("設計", -1)).toEqual(["設", "計", ""]);
  });
});

describe("wrapping", () => {
  it("breaks at the last space that fits", () => {
    expect(wrap("one two three four", 8)).toEqual(["one two", "three", "four"]);
  });

  it("hard-breaks a token rather than leaving a stub", () => {
    expect(wrap(`ab ${"x".repeat(20)}`, 10)).toEqual([
      "ab xxxxxxx",
      "xxxxxxxxxx",
      "xxx",
    ]);
  });

  it("keeps a wide glyph whole at the break", () => {
    const rows = wrap("設計と実装", 7);

    expect(rows).toEqual(["設計と", "実装"]);
    for (const row of rows) expect(cells(row)).toBeLessThanOrEqual(7);
  });

  it("reports the source each row consumed, break spaces included", () => {
    const rows = wrapSegments("one two three four", 8);

    expect(rows.map((row) => row.text)).toEqual(["one two", "three", "four"]);
    expect(rows.map((row) => row.characters)).toEqual([8, 6, 4]);
    expect(rows.reduce((total, row) => total + row.characters, 0)).toBe(
      graphemes("one two three four").length,
    );
  });
});
