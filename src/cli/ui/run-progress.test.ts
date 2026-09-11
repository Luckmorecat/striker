import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { RunJournal, RunJournalEvent } from "../../core/contracts.js";
import { TerminalSession } from "../terminal/terminal-session.js";
import { RunProgress } from "./run-progress.js";

const escape = "\u001B";

class FakeStream extends PassThrough {
  isTTY = true;
  written = "";
  columns = 100;
  rows = 24;
  setRawMode(): this {
    return this;
  }
  constructor() {
    super();
    this.on("data", (chunk: Buffer) => {
      this.written += chunk.toString("utf8");
    });
  }
}

const started: RunJournalEvent = {
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

function open() {
  const output = new FakeStream();
  const terminal = new TerminalSession(new FakeStream(), output);
  return { output, progress: new RunProgress(terminal), terminal };
}

describe("RunProgress", () => {
  it("publishes persisted journal facts through the decorated journal", async () => {
    const { output, progress } = open();
    const journal: RunJournal = {
      append: () => Promise.resolve(),
      load: () => Promise.resolve(null),
      loadActive: () => Promise.resolve(null),
    };
    progress.begin({ backend: "local" });

    await progress.journal(journal).append(started);
    progress.end();

    expect(output.written).toContain("LIVE · Run started.");
  });

  it("seeds the plan into the display it already owns", () => {
    const { output, progress } = open();
    progress.begin({ backend: "docker" });
    const frames = () => output.written.split(`${escape}[H`).length - 1;
    const before = frames();

    progress.plan([
      {
        identity: { id: "07", revision: "r1" },
        instructions: "Implement.",
        title: "Seeded after parsing",
      },
    ]);
    progress.end();

    expect(frames()).toBe(before + 1);
    expect(output.written).toContain("· 07  Seeded after parsing");
    expect(output.written).toContain("PLAN / 0 of 1 certified");
  });

  it("observes verification through the decorated services", async () => {
    const { output, progress } = open();
    progress.begin({ backend: "local" });
    const verified: string[] = [];
    const services = progress.services({
      git: {} as never,
      runner: {} as never,
      verifier: {
        verify: (request) => {
          verified.push(request.command);
          return Promise.resolve({
            command: request.command,
            exitCode: 0,
            output: "",
          });
        },
      },
    });

    await services.verifier.verify({ command: "pnpm check", cwd: "/repo" });
    progress.end();

    expect(verified).toEqual(["pnpm check"]);
    expect(output.written).toContain("LIVE · Verification passed.");
    expect(output.written).toContain("✓ Verifying");
  });
});

describe("RunProgress prompts", () => {
  it("frees the terminal for a prompt and takes it back afterwards", async () => {
    const { progress, terminal } = open();
    progress.begin({ backend: "docker" });

    const acquired = await progress.prompt(() => {
      const release = terminal.acquire();
      release();
      return Promise.resolve("answered");
    });

    expect(acquired).toBe("answered");
    expect(() => {
      progress.end();
    }).not.toThrow();
  });

  it("takes the terminal back when a prompt fails", async () => {
    const { progress, terminal } = open();
    progress.begin({ backend: "local" });

    await expect(
      progress.prompt(() => Promise.reject(new Error("cancelled"))),
    ).rejects.toThrow("cancelled");

    progress.end();
    expect(() => {
      terminal.acquire()();
    }).not.toThrow();
  });

  it("begins the display before the operation that seeds its plan", async () => {
    const { output, progress } = open();

    await progress.run({ backend: "docker" }, () => {
      progress.plan([
        {
          identity: { id: "09", revision: "r1" },
          instructions: "Implement.",
          title: "Parsed in operation",
        },
      ]);
      return Promise.resolve("done");
    });

    expect(output.written).toContain("· 09  Parsed in operation");
  });

  it("ends the display when the command it owns fails", async () => {
    const { progress, terminal } = open();

    await expect(
      progress.run({ backend: "docker" }, () =>
        Promise.reject(new Error("could not open execution")),
      ),
    ).rejects.toThrow("could not open execution");

    expect(() => {
      terminal.acquire()();
    }).not.toThrow();
  });

  it("replaces the previous display when a command begins again", () => {
    const { progress, terminal } = open();

    progress.begin({ backend: "local" });
    progress.begin({ backend: "local" });
    progress.close();

    expect(() => {
      terminal.acquire()();
    }).not.toThrow();
  });

  it("stops publishing to a closed command", async () => {
    const { output, progress } = open();
    progress.begin({ backend: "local" });
    progress.close();
    const before = output.written.length;

    await progress
      .journal({
        append: () => Promise.resolve(),
        load: () => Promise.resolve(null),
        loadActive: () => Promise.resolve(null),
      })
      .append(started);

    expect(output.written.length).toBe(before);
  });
});
