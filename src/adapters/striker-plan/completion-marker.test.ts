import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendCompletionMarker,
  readCompletionMarkers,
} from "./completion-marker.js";

describe("Striker completion markers", () => {
  it("appends one idempotent machine marker after the human log", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-marker-"));
    const logPath = path.join(root, "log.md");
    const identity = { id: "tasks/01.md", revision: "abc123" };
    await writeFile(logPath, "# Log\n\nHuman entry.\n");

    await expect(appendCompletionMarker(logPath, identity)).resolves.toBe(true);
    await expect(appendCompletionMarker(logPath, identity)).resolves.toBe(
      false,
    );

    expect(await readCompletionMarkers(logPath)).toEqual([identity]);
    expect(
      (await readFile(logPath, "utf8")).match(/striker:completed/g),
    ).toHaveLength(1);
  });
});
