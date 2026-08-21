import { describe, expect, it } from "vitest";

import { runCli } from "./program.js";

describe("striker resume", () => {
  it("reports another pause and prints the next recovery commands", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["resume"], {
      answerReader: { read: () => Promise.resolve("") },
      cwd: "/repo",
      permissionConfig: {
        read: () => Promise.resolve("attended"),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      recoveryHandler: {
        answer: () => {
          throw new Error("Unexpected answer");
        },
        resume: () =>
          Promise.resolve({
            message:
              "Run needs attention: verification_failed. Run `striker answer` or `striker resume`.",
            status: "needs_attention",
          }),
      },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text) => (stderr += text) },
      stdout: { write: (text) => (stdout += text) },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("striker answer");
    expect(stderr).toContain("striker resume");
  });
});
