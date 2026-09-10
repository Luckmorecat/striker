import { describe, expect, it } from "vitest";

import type { RecoveryCommandHandler } from "../core/contracts.js";
import { runCli } from "./program.js";

function dependencies(
  handler: RecoveryCommandHandler,
  readAnswer: (file: string | undefined) => Promise<string>,
) {
  let stdout = "";
  let stderr = "";
  return {
    cli: {
      answerReader: { read: readAnswer },
      cwd: "/repo",
      permissionConfig: {
        read: () => Promise.resolve("attended" as const),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      recoveryHandler: handler,
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text: string) => (stderr += text) },
      stdout: { write: (text: string) => (stdout += text) },
    },
    output: () => ({ stderr, stdout }),
  };
}

describe("striker answer", () => {
  it.each([
    [[], undefined, "answer from stdin"],
    [["--file", "answer.txt"], "answer.txt", "answer from file"],
  ] as const)(
    "continues the paused run with %j",
    async (arguments_, file, answer) => {
      let received = "";
      const fixture = dependencies(
        {
          answer: (value) => {
            received = value;
            return Promise.resolve({
              message: "Completed tasks/01.md.",
              status: "completed",
            });
          },
          resume: () => {
            throw new Error("Unexpected resume");
          },
        },
        (selectedFile) => {
          expect(selectedFile).toBe(file);
          return Promise.resolve(answer);
        },
      );

      const exitCode = await runCli(["answer", ...arguments_], fixture.cli);

      expect(exitCode).toBe(0);
      expect(received).toBe(answer);
      expect(fixture.output()).toEqual({
        stderr: "",
        stdout: "Completed tasks/01.md.\n",
      });
    },
  );
});

it("rejects ineligible recovery before consuming an answer", async () => {
  const fixture = dependencies(
    {
      answer: () => {
        throw new Error("Must not answer");
      },
      resume: () => {
        throw new Error("Must not resume");
      },
    },
    () => {
      throw new Error("Must not read");
    },
  );
  const exitCode = await runCli(["answer"], {
    ...fixture.cli,
    recoveryInspector: { inspectRecovery: () => Promise.resolve(null) },
  });
  expect(exitCode).toBe(1);
  expect(fixture.output().stderr).toContain("No Striker run is active");
});

it.each([0, 130] as const)(
  "leaves the run paused with exit %s without submitting",
  async (exitCode) => {
    const fixture = dependencies(
      {
        answer: () => {
          throw new Error("Must not answer");
        },
        resume: () => {
          throw new Error("Must not resume");
        },
      },
      () => Promise.resolve("unused"),
    );
    const result = await runCli(["answer"], {
      ...fixture.cli,
      answerReader: {
        read: () => Promise.resolve({ status: "cancelled" as const, exitCode }),
      },
    });
    expect(result).toBe(exitCode);
    expect(fixture.output()).toEqual({
      stdout: "",
      stderr: "Run left paused.\n",
    });
  },
);

it("inspects before reading and submits exact content once", async () => {
  const order: string[] = [];
  const answer = "  first\nsecond  ";
  const fixture = dependencies(
    {
      answer: (text) => {
        order.push(text);
        return Promise.resolve({
          status: "needs_attention",
          message: "Still paused",
        });
      },
      resume: () => {
        throw new Error("Unexpected resume");
      },
    },
    () => {
      order.push("read");
      return Promise.resolve(answer);
    },
  );
  const context = {
    runId: "run",
    status: "needs_attention" as const,
    task: null,
    attention: null,
    availability: { answer: null, resume: null, retry: null },
  };
  expect(
    await runCli(["answer"], {
      ...fixture.cli,
      recoveryInspector: {
        inspectRecovery: () => {
          order.push("inspect");
          return Promise.resolve(context);
        },
      },
    }),
  ).toBe(1);
  expect(order).toEqual(["inspect", "read", answer]);
  expect(fixture.output().stderr).toContain("Still paused");
});

it("rejects an unavailable answer before opening even a file", async () => {
  const fixture = dependencies(
    {
      answer: () => {
        throw new Error("Must not answer");
      },
      resume: () => {
        throw new Error("Must not resume");
      },
    },
    () => {
      throw new Error("Must not read");
    },
  );
  const context = {
    runId: "run",
    status: "needs_attention" as const,
    task: null,
    attention: null,
    availability: {
      answer: "Paused Striker run has no session to answer",
      resume: null,
      retry: null,
    },
  };
  expect(
    await runCli(["answer", "--file", "answer.txt"], {
      ...fixture.cli,
      recoveryInspector: { inspectRecovery: () => Promise.resolve(context) },
    }),
  ).toBe(1);
  expect(fixture.output().stderr).toContain("no session to answer");
});
