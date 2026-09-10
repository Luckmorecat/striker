import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { TerminalSession } from "./terminal-session.js";
import { chooseRecoveryAction } from "./recovery-actions.js";
import type { RecoveryInspection } from "../../core/recovery-operations.js";
const context: RecoveryInspection = {
  runId: "run",
  status: "needs_attention",
  task: null,
  attention: { reason: "verification_failed", detail: "Full evidence" },
  availability: { answer: "Review owns recovery", resume: null, retry: null },
};
function fixture() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true });
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
it("shows only available operations and releases the terminal on selection", async () => {
  const test = fixture();
  const result = chooseRecoveryAction(test.session, context);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(test.rendered()).toContain("Full evidence");
  expect(test.rendered()).toContain("Resume repair");
  expect(test.rendered()).not.toContain("Answer");
  test.input.write("\r");
  expect(await result).toBe("resume");
  expect(test.input.isRaw).toBe(false);
  expect(test.input.listenerCount("data")).toBe(0);
});
it.each([
  ["\x03", 130],
  ["\x04", 0],
  ["EOF", 0],
  ["\x1b[B\x1b[B\r", 0],
] as const)("leaves paused via %s", async (key, exitCode) => {
  const test = fixture();
  const result = chooseRecoveryAction(test.session, context);
  if (key === "EOF") test.input.end();
  else test.input.write(key);
  expect(await result).toEqual({ exitCode });
  expect(test.input.listenerCount("data")).toBe(0);
  expect(test.input.isRaw).toBe(false);
});
it("suppresses permission prompts without granting permission", async () => {
  const test = fixture();
  test.session.setEnabled(false);
  expect(test.session.interactive).toBe(false);
  expect(await test.session.permission({})).toEqual({ outcome: "reject_once" });
  expect(test.rendered()).toBe("");
});

it("does not carry buffered keys through action, permission, and answer handoffs", async () => {
  const test = fixture();
  const selection = chooseRecoveryAction(test.session, context);
  test.input.write("\r\r");
  expect(await selection).toBe("resume");
  test.input.write("y\n"); // Leftover input from the previous prompt.
  const permission = test.session.permission({ action: "write" });
  test.input.write("n\n");
  expect(await permission).toEqual({ outcome: "reject_once" });
  expect(test.input.isPaused()).toBe(true);
  expect(test.input.listenerCount("data")).toBe(0);
});

it("shows core blockers and only Leave paused when no continuation is useful", async () => {
  const test = fixture();
  const result = chooseRecoveryAction(test.session, {
    ...context,
    availability: {
      answer: "No session",
      resume: "No session",
      retry: "Revise routes",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(test.rendered()).toContain("Revise routes");
  expect(test.rendered()).toContain("Leave paused");
  expect(test.rendered()).not.toContain("Resume repair");
  test.input.write("\r");
  expect(await result).toEqual({ exitCode: 0 });
});

it("selects Retry and ignores pasted action keys", async () => {
  const test = fixture();
  const result = chooseRecoveryAction(test.session, context);
  test.input.write("\x1b[200~\r\x1b[201~");
  test.input.write("\x1b[B\r");
  expect(await result).toBe("retry");
});

it("restores terminal ownership on a menu input error", async () => {
  const test = fixture();
  const result = chooseRecoveryAction(test.session, context);
  test.input.emit("error", new Error("Terminal failed"));
  await expect(result).rejects.toThrow("Terminal failed");
  expect(test.input.isRaw).toBe(false);
  expect(test.input.listenerCount("data")).toBe(0);
  expect(test.output.listenerCount("resize")).toBe(0);
  test.session.acquire()();
});
