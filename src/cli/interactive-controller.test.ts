import { expect, it } from "vitest";
import { runCli, type CliDependencies } from "./program.js";
import type { RecoveryInspection } from "../core/recovery-operations.js";

const context: RecoveryInspection = {
  runId: "run",
  status: "needs_attention",
  task: null,
  attention: { reason: "assumption_needs_decision", detail: "Choose" },
  availability: { answer: null, resume: null, retry: null },
};
function fixture() {
  const answers: string[] = [];
  let stderr = "";
  let enabled = true;
  const paused = { status: "needs_attention" as const, message: "Paused" };
  const cli: CliDependencies = {
    cwd: "/repo",
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
    skillInstaller: {
      install: () => Promise.resolve({ changed: false }),
      supportedHarnesses: ["codex"],
    },
    stdout: { write: () => undefined },
    stderr: {
      write: (text) => {
        stderr += text;
      },
    },
    runHandler: { run: () => Promise.resolve(paused) },
    recoveryHandler: {
      resume: () => Promise.resolve(paused),
      answer: (answer) => {
        answers.push(answer);
        return Promise.resolve(
          answers.length === 2
            ? { status: "completed" as const, message: "Done" }
            : paused,
        );
      },
    },
    operationHandler: {
      retry: () => Promise.resolve(paused),
      discard: () => Promise.resolve(),
      status: () => Promise.resolve(null),
    },
    recoveryInspector: { inspectRecovery: () => Promise.resolve(context) },
    answerReader: {
      read: () =>
        Promise.resolve({ status: "submitted", text: " decision\nline " }),
    },
    interaction: {
      get interactive() {
        return enabled;
      },
      setEnabled: (value) => {
        enabled = value;
      },
      choose: () => {
        throw new Error("Decision must open directly");
      },
    },
  };
  return { cli, answers, stderr: () => stderr };
}
it.each([["run", "plan"], ["resume"], ["retry"], ["answer"]])(
  "%j continues repeated decisions and submits each answer once",
  async (...args) => {
    const test = fixture();
    expect(await runCli(args, test.cli)).toBe(0);
    expect(test.answers).toEqual([" decision\nline ", " decision\nline "]);
  },
);

it.each(["resume", "retry"] as const)(
  "continues a selected %s once then displays new attention",
  async (action) => {
    const test = fixture();
    const calls: string[] = [];
    const paused = { status: "needs_attention" as const, message: "Paused" };
    let inspections = 0;
    const exit = await runCli(["run", "plan"], {
      ...test.cli,
      recoveryInspector: {
        inspectRecovery: () =>
          Promise.resolve({
            ...context,
            attention: {
              reason: "verification_failed",
              detail: `Pause ${String(++inspections)}`,
            },
            availability: {
              answer: "Review owns recovery",
              resume: null,
              retry: null,
            },
          }),
      },
      recoveryHandler: {
        answer: () => {
          throw new Error("Unexpected answer");
        },
        resume: () => {
          calls.push("resume");
          return Promise.resolve(paused);
        },
      },
      operationHandler: {
        retry: () => {
          calls.push("retry");
          return Promise.resolve(paused);
        },
        discard: () => {
          throw new Error("Unexpected discard");
        },
        status: () => Promise.resolve(null),
      },
      interaction: {
        interactive: true,
        setEnabled: () => undefined,
        choose: (inspection) => {
          expect(inspection.attention?.detail).toBe(
            `Pause ${String(calls.length + 1)}`,
          );
          return Promise.resolve(calls.length === 0 ? action : { exitCode: 0 });
        },
      },
    });
    expect(exit).toBe(0);
    expect(calls).toEqual([action]);
    expect(test.stderr()).toBe("Run left paused.\n");
  },
);

it.each([0, 130] as const)(
  "cancels an attached decision with exit %s",
  async (exitCode) => {
    const test = fixture();
    expect(
      await runCli(["run", "plan"], {
        ...test.cli,
        answerReader: {
          read: () => Promise.resolve({ status: "cancelled", exitCode }),
        },
      }),
    ).toBe(exitCode);
    expect(test.answers).toEqual([]);
    expect(test.stderr()).toBe("Run left paused.\n");
  },
);

it.each([["run", "plan"], ["resume"], ["retry"], ["answer"]])(
  "%j suppresses interaction and preserves attention exit 1",
  async (...args) => {
    const test = fixture();
    expect(
      await runCli([...args, "--no-interactive"], {
        ...test.cli,
        answerReader: {
          read: () => {
            expect(test.cli.interaction?.interactive).toBe(false);
            return Promise.resolve("stdin answer");
          },
        },
      }),
    ).toBe(1);
    expect(test.answers).toEqual(args[0] === "answer" ? ["stdin answer"] : []);
    expect(test.stderr()).toContain("Available recovery:");
  },
);

it.each([[], ["--file", "answer.txt"]])(
  "submits automated answers once for %j",
  async (...options) => {
    const test = fixture();
    expect(
      await runCli(["answer", ...options], {
        ...test.cli,
        answerReader: { read: () => Promise.resolve("full\nanswer\n") },
      }),
    ).toBe(1);
    expect(test.answers).toEqual(["full\nanswer\n"]);
  },
);

it.each(["failed", "rejected"])(
  "returns exit 1 on %s without opening input",
  async (outcome) => {
    const test = fixture();
    expect(
      await runCli(["run", "plan"], {
        ...test.cli,
        runHandler: {
          run: () =>
            outcome === "failed"
              ? Promise.resolve({
                  status: "failed",
                  message: "Execution failed",
                })
              : Promise.reject(new Error("Execution rejected")),
        },
      }),
    ).toBe(1);
    expect(test.answers).toEqual([]);
    expect(test.stderr()).toContain("Execution");
  },
);

it("renders only core-approved recovery guidance for noninteractive attention", async () => {
  const test = fixture();
  expect(
    await runCli(["run", "plan", "--no-interactive"], {
      ...test.cli,
      recoveryInspector: {
        inspectRecovery: () =>
          Promise.resolve({
            ...context,
            availability: {
              answer: "No session",
              resume: "No session",
              retry: null,
            },
          }),
      },
    }),
  ).toBe(1);
  expect(test.stderr()).toContain("Available recovery: striker retry.");
  expect(test.stderr()).not.toContain("striker answer");
  expect(test.stderr()).not.toContain("striker resume");
});
