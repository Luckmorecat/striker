import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { RunJournalEvent } from "../../core/contracts.js";
import { TerminalSession } from "../terminal/terminal-session.js";
import { createRunObservations } from "./progress-events.js";
import { ProgressSession } from "./progress-session.js";

const escape = "\u001B";

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
  constructor(interactive = true) {
    super();
    this.isTTY = interactive;
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
const runStarted: RunJournalEvent = {
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
};
const selected: RunJournalEvent = {
  runId: "run",
  task,
  type: "task_selected",
};
const attempt: RunJournalEvent = {
  attempt: 1,
  runId: "run",
  task: task.identity,
  type: "task_attempt_started",
};

function open(
  options: {
    interactive?: boolean;
    history?: readonly RunJournalEvent[];
    tasks?: readonly { id: string; title: string }[];
  } = {},
) {
  const input = new FakeInput();
  const output = new FakeOutput(options.interactive ?? true);
  const terminal = new TerminalSession(input, output);
  const observations = createRunObservations();
  const timer = manualClock();
  const session = ProgressSession.start({
    clock: timer.clock,
    elapsed: () => 72,
    ...(options.history === undefined ? {} : { history: options.history }),
    observations,
    seed: {
      backend: "docker",
      plan: {
        tasks: options.tasks ?? [{ id: "02", title: "Answer command" }],
      },
    },
    terminal,
  });
  return { input, observations, output, session, terminal, timer };
}

function publishStart(context: ReturnType<typeof open>) {
  for (const event of [runStarted, selected, attempt])
    context.observations.observe({ event, kind: "journal" });
}

describe("plain output", () => {
  it("writes stage lines without taking the terminal", () => {
    const context = open({ interactive: false });

    publishStart(context);

    expect(context.output.written).toContain(
      "Selected task 02: Answer command",
    );
    expect(context.output.written).not.toContain(escape);
    expect(context.input.rawModes).toEqual([]);
    expect(context.timer.running).toBe(false);
  });

  it("reports each distinct stage once", () => {
    const context = open({ interactive: false });

    publishStart(context);
    context.observations.observe({
      command: "pnpm check",
      kind: "verification",
      phase: "started",
    });

    expect(context.output.written.split("\n").filter(Boolean)).toEqual([
      "Run started.",
      "Selected task 02: Answer command",
      "Starting attempt 1 on task 02.",
      "Verifying with pnpm check.",
    ]);
  });
});

describe("interactive dashboard", () => {
  it("takes the terminal and paints the dashboard on a tick", () => {
    const context = open();

    publishStart(context);
    context.timer.fire();

    expect(context.input.rawModes).toEqual([true]);
    expect(context.output.written).toContain("TASK PIPELINE");
    expect(context.output.written).toContain("● 02  Answer command");
  });

  it("coalesces several observations into one repaint", () => {
    const context = open();
    const frames = () => context.output.written.split(`${escape}[H`).length - 1;
    const before = frames();

    publishStart(context);

    expect(frames()).toBe(before);

    context.timer.fire();

    expect(frames()).toBe(before + 1);
  });

  it("toggles motion and detail from the keyboard", () => {
    const context = open();
    publishStart(context);

    context.input.write("d");
    context.timer.fire();

    expect(context.output.written).toContain("↑/↓ scroll");

    context.input.write("m");
    context.timer.fire();

    expect(context.output.written).toContain("m motion");
  });

  it("ignores quit requests while the run executes", () => {
    const context = open();
    publishStart(context);

    context.input.write("q");
    context.timer.fire();

    expect(context.timer.running).toBe(true);
    expect(context.input.rawModes).toEqual([true]);
  });

  it("scrolls expanded details without losing the dashboard", () => {
    const context = open();
    publishStart(context);
    context.input.write("d");
    context.input.write(`${escape}[B`);
    context.timer.fire();

    expect(context.output.written).toContain("TASK PIPELINE");
  });

  it("keeps the arrows live after scrolling past the first task", () => {
    const tasks = Array.from({ length: 30 }, (_, index) => ({
      id: String(index + 1).padStart(2, "0"),
      title: `Task ${String(index + 1)}`,
    }));
    const context = open({ tasks });
    publishStart(context);
    context.input.write("d");
    for (let press = 0; press < 60; press += 1)
      context.input.write(`${escape}[A`);
    context.timer.fire();
    const top = context.output.written.length;

    context.input.write(`${escape}[B`);
    context.timer.fire();
    const frame = context.output.written.slice(top);

    expect(context.output.written.slice(0, top)).toContain("· 01  Task 1");
    expect(frame).toContain("TASK PIPELINE");
    expect(frame).not.toContain("· 01  Task 1");
    expect(frame).toContain("● 02  Task 2");
  });
});

describe("prompt handoff", () => {
  it("frees the terminal for a prompt and retains the dashboard above it", () => {
    const context = open();
    publishStart(context);
    context.timer.fire();

    context.session.suspend();

    expect(context.timer.running).toBe(false);
    expect(context.input.isRaw).toBe(false);
    expect(context.output.written).toContain("TASK PIPELINE");
    expect(context.output.written.endsWith("\n")).toBe(true);
    expect(() => {
      context.terminal.acquire()();
    }).not.toThrow();
  });

  it("keeps facts that arrive during a prompt out of the prompt area", () => {
    const context = open();
    publishStart(context);
    context.session.suspend();
    const before = context.output.written.length;

    context.observations.observe({
      command: "pnpm check",
      kind: "verification",
      phase: "started",
    });

    expect(context.output.written.length).toBe(before);

    context.session.resume();
    context.timer.fire();

    expect(context.output.written.slice(before)).toContain(
      "LIVE · Verifying with pnpm check.",
    );
  });

  it("takes the terminal back when the prompt finishes", () => {
    const context = open();
    publishStart(context);
    context.session.suspend();

    context.session.resume();
    context.timer.fire();

    expect(context.timer.running).toBe(true);
    expect(context.input.isRaw).toBe(true);
  });

  it("stops the animation while the run needs attention", () => {
    const context = open();
    publishStart(context);
    context.observations.observe({
      event: {
        attention: {
          detail: "Answer the question.",
          reason: "assumption_needs_decision",
        },
        runId: "run",
        session: { id: "s" },
        task: task.identity,
        type: "run_needs_attention",
      },
      kind: "journal",
    });
    const before = context.output.written.length;
    context.timer.fire();
    const frame = context.output.written.slice(before);

    expect(frame).toContain("? Answer the question.");
    expect(frame).not.toContain(`${escape}[38;5;`);
  });

  it("repaints a still dashboard after the terminal is resized", () => {
    const context = open();
    publishStart(context);
    context.input.write("m");
    context.timer.fire();
    const still = context.output.written.length;
    context.timer.fire();

    expect(context.output.written.length).toBe(still);

    context.output.columns = 60;
    context.output.emit("resize");
    context.timer.fire();
    const frame = context.output.written.slice(still);

    expect(frame).toContain("TASK PIPELINE");
    expect(frame).not.toContain("PLAN /");
  });
});

describe("cleanup", () => {
  it("restores the terminal and releases ownership once", () => {
    const context = open();
    publishStart(context);
    context.timer.fire();

    context.session.dispose();
    context.session.dispose();

    expect(context.timer.running).toBe(false);
    expect(context.input.rawModes).toEqual([true, false]);
    expect(context.output.written).toContain(`${escape}[?25h`);
    expect(() => {
      context.terminal.acquire()();
    }).not.toThrow();
  });

  it("restores the terminal on the existing interruption path", () => {
    const interrupts: { raw: boolean; cursorShown: boolean }[] = [];
    const input = new FakeInput();
    const output = new FakeOutput();
    const terminal = new TerminalSession(input, output);
    const timer = manualClock();
    ProgressSession.start({
      clock: timer.clock,
      elapsed: () => 0,
      observations: createRunObservations(),
      // The signal may end the process at once: restore the terminal first.
      onInterrupt: () =>
        interrupts.push({
          cursorShown: output.written.includes(`${escape}[?25h`),
          raw: input.isRaw,
        }),
      seed: { backend: "local" },
      terminal,
    });

    input.write("\u0003");

    expect(interrupts).toEqual([{ cursorShown: true, raw: false }]);
    expect(input.rawModes).toEqual([true, false]);
    expect(() => {
      terminal.acquire()();
    }).not.toThrow();
  });

  it("leaves stdin paused when it was not already flowing", () => {
    const context = open();
    publishStart(context);

    expect(context.input.readableFlowing).toBe(true);

    context.session.dispose();

    expect(context.input.readableFlowing).toBe(false);
  });

  it("stops painting after disposal", () => {
    const context = open();
    context.session.dispose();
    const after = context.output.written.length;

    publishStart(context);
    context.timer.fire();

    expect(context.output.written.length).toBe(after);
  });

  it("releases the terminal when input ends", async () => {
    const context = open();
    publishStart(context);

    context.input.end();
    await new Promise((resolve) => setImmediate(resolve));

    expect(context.timer.running).toBe(false);
    expect(() => {
      context.terminal.acquire()();
    }).not.toThrow();
  });
});

describe("recovery history", () => {
  const blocking = {
    findings: [
      {
        fix: "fix",
        kind: "rule_violation" as const,
        location: { line: 1 },
        message: "Input consumed before eligibility is checked",
        path: "src/a.ts",
        rule: "rule",
        severity: "blocking" as const,
      },
    ],
    kind: "standards" as const,
    resultCommit: "candidate-a",
    startCommit: "base",
    verdict: "changes_required" as const,
  };
  const history: readonly RunJournalEvent[] = [
    runStarted,
    selected,
    attempt,
    {
      attempt: 1,
      changedPaths: ["src/a.ts"],
      completion: { summary: "done" },
      resultCommit: "candidate-a",
      runId: "run",
      session: { id: "s" },
      startCommit: "base",
      task: task.identity,
      type: "standards_review_started",
      verification: { command: "pnpm check", exitCode: 0, output: "ok" },
    },
    {
      result: blocking,
      runId: "run",
      session: { id: "s" },
      task: task.identity,
      type: "standards_review_completed",
    },
    {
      result: blocking,
      runId: "run",
      session: { id: "s" },
      task: task.identity,
      type: "standards_repair_started",
    },
  ];

  it("restores rounds and findings from the journal", () => {
    const context = open({ history });

    context.timer.fire();

    expect(context.output.written).toContain(
      "! REVIEW · 1 blocking finding from round 1",
    );
    expect(context.output.written).toContain("· round 2");
    expect(context.output.written).toContain("↻ Verifying · recheck required");
  });

  it("does not double count a repair the command re-observes", () => {
    const context = open({ history });

    const repair = history.at(-1);
    if (repair === undefined) throw new Error("missing repair fixture");
    context.observations.observe({ event: repair, kind: "journal" });
    context.timer.fire();

    expect(context.output.written).toContain("· round 2");
    expect(context.output.written).not.toContain("round 3");
  });
});
