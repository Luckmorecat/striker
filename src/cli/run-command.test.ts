import { describe, expect, it } from "vitest";

import type { RunCommandRequest } from "../core/contracts.js";
import { runCli } from "./program.js";

describe("striker run", () => {
  it("passes the source and explicit dirty override through an injected handler", async () => {
    let request: RunCommandRequest | undefined;
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["run", "plans/current", "--allow-dirty"], {
      cwd: "/repo",
      permissionConfig: {
        read: () => Promise.resolve("unattended"),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      runHandler: {
        run: (value) => {
          request = value;
          return Promise.resolve({
            message: "Completed tasks/01.md.",
            status: "completed",
          });
        },
      },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text) => (stderr += text) },
      stdout: { write: (text) => (stdout += text) },
    });

    expect(exitCode).toBe(0);
    expect(request).toEqual({
      allowDirty: true,
      approvalMode: "unattended",
      source: "plans/current",
    });
    expect(stdout).toBe(
      "Permission mode: unattended.\nCompleted tasks/01.md.\n",
    );
    expect(stderr).toBe("");
  });

  it("does not report success when evidence needs attention", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["run", "plans/current"], {
      cwd: "/repo",
      permissionConfig: {
        read: () => Promise.resolve("auto-review"),
        write: () => Promise.resolve(),
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      runHandler: {
        run: () =>
          Promise.resolve({
            message: "Run needs attention: verification_failed.",
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
    expect(stdout).toBe("Permission mode: auto-review.\n");
    expect(stderr).toContain("verification_failed");
  });
});
