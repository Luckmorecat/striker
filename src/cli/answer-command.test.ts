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
