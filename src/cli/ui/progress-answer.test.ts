import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { RunJournalEvent } from "../../core/contracts.js";
import { TerminalSession } from "../terminal/terminal-session.js";
import { browsingHint, editingHint } from "./answer-block.js";
import { createRunObservations } from "./progress-events.js";
import { ProgressSession } from "./progress-session.js";

const escape = "";
const question =
  "Browser checks need missing system libraries. Continue, or pause?";

class FakeInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];
  setRawMode(raw: boolean): this {
    this.isRaw = raw;
    this.rawModes.push(raw);
    return this;
  }
}

class FakeOutput extends PassThrough {
  isTTY = true;
  columns = 100;
  rows = 24;
  written = "";
  constructor() {
    super();
    this.on("data", (chunk: Buffer) => {
      this.written += chunk.toString("utf8");
    });
  }
}

function manualClock() {
  let tick: (() => void) | null = null;
  return {
    clock: {
      start: (onTick: () => void) => {
        tick = onTick;
        return () => {
          tick = null;
        };
      },
    },
    fire: () => tick?.(),
    get running() {
      return tick !== null;
    },
  };
}

const task = {
  identity: { id: "02", revision: "r1" },
  instructions: "Implement.",
  title: "Answer command",
};
const history: readonly RunJournalEvent[] = [
  {
    planId: "plan",
    request: {
      completedTasks: [],
      planId: "plan",
      runId: "run",
      skills: [],
      taskSource: { location: "/plan", type: "striker" },
    },
    runId: "run",
    type: "run_started",
  },
  { runId: "run", task, type: "task_selected" },
  {
    attempt: 1,
    runId: "run",
    task: task.identity,
    type: "task_attempt_started",
  },
  {
    attention: { detail: question, reason: "assumption_needs_decision" },
    runId: "run",
    session: { id: "s" },
    task: task.identity,
    type: "run_needs_attention",
  },
];

function open(onInterrupt?: () => void) {
  const input = new FakeInput();
  const output = new FakeOutput();
  const terminal = new TerminalSession(input, output);
  const observations = createRunObservations();
  const timer = manualClock();
  const session = ProgressSession.start({
    clock: timer.clock,
    elapsed: () => 72,
    history,
    observations,
    ...(onInterrupt === undefined ? {} : { onInterrupt }),
    seed: {
      backend: "docker",
      plan: { tasks: [{ id: "02", title: "Answer command" }] },
      selection: { effort: "high", model: "gpt-5.6-sol" },
    },
    terminal,
  });
  return { input, observations, output, session, terminal, timer };
}

function type(context: ReturnType<typeof open>, ...keys: string[]): void {
  for (const key of keys) context.input.write(key);
  context.timer.fire();
}

/** Latest painted frame, with its escape sequences removed. */
function frame(context: ReturnType<typeof open>): string {
  const frames = context.output.written.split(`${escape}[H`);
  return (frames.at(-1) ?? "").replaceAll(
    new RegExp(`${escape}\\[[0-9;?>]*[A-Za-z~]`, "gu"),
    "",
  );
}

describe("answering inside the dashboard", () => {
  it("appends the block to the display the run already owns", async () => {
    const context = open();
    const answer = context.session.answer(question);

    expect(frame(context)).toContain("? ANSWER NEEDED · run paused");
    expect(frame(context)).toContain(question);
    expect(frame(context)).toContain("? Awaiting answer");
    // The dashboard context stays; nothing replaced the screen.
    expect(frame(context)).toContain("STRIKER / run overview");
    expect(frame(context)).toContain("MODEL gpt-5.6-sol · effort high");
    expect(frame(context)).toContain(browsingHint);

    // Browsing keeps the dashboard's own keys; Tab hands them to the draft.
    type(context, "answer");
    expect(frame(context)).toContain("Type your decision…");

    type(context, "\t", "answer", "\r");
    await expect(answer).resolves.toEqual({
      status: "submitted",
      text: "answer",
    });
  });

  it("keeps dashboard shortcuts out of the draft once focused", async () => {
    const context = open();
    const answer = context.session.answer(question);

    type(context, "m");
    expect(frame(context)).not.toContain("│ m");

    type(context, "\t");
    expect(frame(context)).toContain(editingHint);

    type(context, "make it demand more detail");
    expect(frame(context)).toContain("│ make it demand more detail");

    type(context, "\r");
    await expect(answer).resolves.toEqual({
      status: "submitted",
      text: "make it demand more detail",
    });
  });

  it("edits the draft with ordinary keys and preserves its whitespace", async () => {
    const context = open();
    const answer = context.session.answer(question);

    type(context, "\t", "  firstX", `${escape}[13;2u`, "second  ");
    type(context, `${escape}[D`, `${escape}[D`, "!");

    await expect(
      (() => {
        type(context, "\r");
        return answer;
      })(),
    ).resolves.toEqual({ status: "submitted", text: "  first\nsecond!  " });
  });

  it("takes a bracketed paste as literal text, however long", async () => {
    const context = open();
    const answer = context.session.answer(question);
    const paste = "pasted line\n".repeat(20);

    type(context, "\t", `${escape}[200~${paste}${escape}[201~`, "end");
    type(context, "\r");

    await expect(answer).resolves.toEqual({
      status: "submitted",
      text: `${paste}end`,
    });
  });
});

describe("submitting the answer", () => {
  it("rejects a blank answer and keeps asking", async () => {
    const context = open();
    const answer = context.session.answer(question);

    type(context, "\t", "   ", "\r");

    expect(frame(context)).toContain("Answer cannot be blank");
    expect(context.timer.running).toBe(true);

    type(context, "decision", "\r");
    await expect(answer).resolves.toEqual({
      status: "submitted",
      text: "   decision",
    });
  });

  it("submits exactly once, then removes the composer", async () => {
    const context = open();
    const answer = context.session.answer(question);

    type(context, "\t", "first", "\r");
    await expect(answer).resolves.toEqual({
      status: "submitted",
      text: "first",
    });

    type(context, "second", "\r");

    expect(frame(context)).not.toContain("? ANSWER NEEDED");
    expect(frame(context)).not.toContain("│ second");
    expect(frame(context)).toContain("STRIKER / run overview");
  });

  it("resumes the same dashboard on the run's own observations", async () => {
    const context = open();
    const answer = context.session.answer(question);
    type(context, "\t", "continue", "\r");
    await answer;

    context.observations.observe({
      event: {
        answer: "continue",
        runId: "run",
        session: { id: "s" },
        task: task.identity,
        type: "run_answered",
      },
      kind: "journal",
    });
    context.timer.fire();

    expect(frame(context)).toContain("LIVE · Applying your decision");
    expect(frame(context)).not.toContain("? Awaiting answer");
  });
});

describe("leaving the draft without submitting", () => {
  it("returns to browsing on Escape without resuming the run", async () => {
    const context = open();
    void context.session.answer(question);

    type(context, "\t", "half written");
    expect(frame(context)).toContain("│ half written");

    // A lone Escape is only a key once the terminal cannot extend it.
    context.input.write(escape);
    await new Promise((resolve) => setTimeout(resolve, 30));
    context.timer.fire();

    expect(frame(context)).toContain(browsingHint);
    // The draft survives; nothing was submitted and the run stays paused.
    expect(frame(context)).toContain("│ half written");
    expect(context.timer.running).toBe(true);
  });

  it.each([
    ["", 130],
    ["", 0],
    ["EOF", 0],
  ] as const)("cancels the paused run with %s", async (key, exitCode) => {
    const context = open();
    const answer = context.session.answer(question);
    type(context, "\t", "partial answer");

    if (key === "EOF") context.input.end();
    else type(context, key);

    await expect(answer).resolves.toEqual({ exitCode, status: "cancelled" });
    expect(context.input.isRaw).toBe(false);
    expect(context.input.listenerCount("data")).toBe(0);
    expect(context.output.written).toContain(`${escape}[?25h`);
    expect(() => {
      context.terminal.acquire()();
    }).not.toThrow();
  });

  it("interrupts an executing run rather than an answer", () => {
    let interrupted = 0;
    const context = open(() => {
      interrupted += 1;
    });

    type(context, "");

    expect(interrupted).toBe(1);
    expect(context.input.isRaw).toBe(false);
  });
});

describe("reading the question", () => {
  const wall = Array.from(
    { length: 40 },
    (_, line) =>
      `Paragraph ${String(line)} of a question that outruns a screen.`,
  ).join("\n\n");

  it("never forces a reader back to the input on a redraw", () => {
    const context = open();
    void context.session.answer(wall);
    type(context, `${escape}[6~`);
    const settled = frame(context);

    context.observations.observe({
      activity: "note",
      kind: "activity",
      text: "The agent is still narrating while you read.",
    });
    context.timer.fire();

    expect(frame(context).split("\n")[0]).toBe(settled.split("\n")[0]);
    expect(context.output.written.endsWith(`${escape}[?25l`)).toBe(true);
  });

  it("reveals the caret when the operator focuses the draft", () => {
    const context = open();
    void context.session.answer(wall);

    expect(frame(context)).not.toContain("Type your decision");

    type(context, "\t");

    expect(frame(context)).toContain("Type your decision");
    expect(context.output.written).toMatch(
      new RegExp(`${escape}\\[\\d+;3H${escape}\\[\\?25h$`, "u"),
    );
  });

  it("keeps the question and draft across a resize", () => {
    const context = open();
    void context.session.answer(wall);
    type(context, "\t", "a decision that survives");

    context.output.columns = 80;
    context.output.emit("resize");
    context.timer.fire();

    expect(frame(context)).toContain("│ a decision that survives");
    expect(frame(context)).toContain("Paragraph 39");
  });
});
