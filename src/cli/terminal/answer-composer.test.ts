import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { TerminalSession } from "./terminal-session.js";
import { composeAnswer } from "./answer-composer.js";

function fixture() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), {
    isTTY: true,
    columns: 40,
    rows: 24,
  });
  let rendered = "";
  output.on("data", (data: Buffer) => {
    rendered += data.toString();
  });
  return {
    input,
    output,
    session: new TerminalSession(input, output),
    rendered: () => rendered,
  };
}
const context = {
  runId: "run",
  status: "needs_attention" as const,
  task: { identity: { id: "01", revision: "r1" }, title: "Task title" },
  attention: {
    reason: "verification_failed" as const,
    detail: "Persisted detail",
  },
  availability: { answer: null, resume: null, retry: null },
};

describe("Pi answer composer", () => {
  it("shows context and preserves editing, modified Enter, and expanded paste", async () => {
    const test = fixture();
    const answer = composeAnswer(test.session, context);
    expect(test.rendered()).toContain("Persisted detail");
    test.input.write("  firstX\x7f\x1b[13;2u");
    const paste = "pasted line\n".repeat(20);
    test.input.write(`\x1b[200~${paste}\x1b[201~`);
    test.input.write("last\x1b\rline  \r");
    expect(await answer).toEqual({
      status: "submitted",
      text: `  first\n${paste}last\nline  `,
    });
    expect(test.input.isRaw).toBe(false);
    expect(test.input.isPaused()).toBe(true);
    expect(test.input.listenerCount("data")).toBe(0);
  });
});

describe("answer input lifecycle", () => {
  it.each([
    ["\x03", 130],
    ["\x04", 0],
    ["EOF", 0],
  ] as const)("cancels partial input with %s", async (key, exitCode) => {
    const test = fixture();
    const answer = composeAnswer(test.session, context);
    test.input.write("partial answer");
    if (key === "EOF") test.input.end();
    else test.input.write(key);
    expect(await answer).toEqual({ status: "cancelled", exitCode });
    expect(test.input.isRaw).toBe(false);
    for (const event of ["data", "end", "close", "error"])
      expect(test.input.listenerCount(event)).toBe(0);
    expect(test.output.listenerCount("resize")).toBe(0);
    const release = test.session.acquire();
    release();
  });
  it("reprompts on blank input, then releases input before a permission request", async () => {
    const test = fixture();
    const answer = composeAnswer(test.session, context);
    test.input.write("  \r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(test.rendered()).toContain("Answer cannot be blank");
    test.input.write("decision\r\r");
    expect(await answer).toEqual({ status: "submitted", text: "  decision" });
    const permission = test.session.permission({ action: "read" });
    test.input.write("y\n");
    expect(await permission).toEqual({ outcome: "allow_once" });
    expect(test.input.listenerCount("data")).toBe(0);
  });
  it("releases raw mode and ownership on input errors", async () => {
    const test = fixture();
    const answer = composeAnswer(test.session, context);
    test.input.emit("error", new Error("input failed"));
    await expect(answer).rejects.toThrow("input failed");
    expect(test.input.isRaw).toBe(false);
    expect(test.input.listenerCount("data")).toBe(0);
    const release = test.session.acquire();
    release();
  });
});
