import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createAnswerReader } from "./answer-reader.js";
import { TerminalSession } from "./terminal-session.js";

it("reads a complete UTF-8 file without taking terminal input", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-answer-"));
  try {
    await writeFile(path.join(root, "answer.txt"), "  Рішення\nsecond line\n");
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const reader = createAnswerReader(root, new TerminalSession(input, output));
    expect(await reader.read("answer.txt")).toBe("  Рішення\nsecond line\n");
    expect(output.readableLength).toBe(0);
    expect(input.listenerCount("data")).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  [false, true],
  [true, false],
])(
  "reads stdin to EOF when terminal detection is %s/%s",
  async (stdinTty, stderrTty) => {
    const input = Object.assign(new PassThrough(), { isTTY: stdinTty });
    const output = Object.assign(new PassThrough(), { isTTY: stderrTty });
    const reader = createAnswerReader(
      "/unused",
      new TerminalSession(input, output),
    );
    const answer = reader.read(undefined);
    const content = Buffer.from("  рішення\nnext\r\n");
    input.write(content.subarray(0, 3));
    await Promise.resolve();
    input.end(content.subarray(3));
    expect(await answer).toBe("  рішення\nnext\r\n");
    expect(output.readableLength).toBe(0);
  },
);
