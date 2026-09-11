import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { FileRunJournal } from "./file-run-journal.js";

it.each([2, 3, 4, 5, 6, 7])(
  "rejects retired journal v%s without rewriting events",
  async (version) => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-journal-version-"));
    const planRoot = path.join(root, "plans/plan-1");
    const eventsPath = path.join(planRoot, "events.ndjson");
    const schema = `striker.plan-journal.v${String(version)}`;
    const content = `${JSON.stringify({ event: {}, schema })}\n`;
    await mkdir(planRoot, { recursive: true });
    await writeFile(eventsPath, content);

    await expect(new FileRunJournal(root).load("plan-1")).rejects.toThrow(
      `Unsupported Striker plan journal schema: ${schema}`,
    );
    expect(await readFile(eventsPath, "utf8")).toBe(content);
  },
);
