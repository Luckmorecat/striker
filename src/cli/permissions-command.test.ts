import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalPermissionConfig } from "../permissions/local-permission-config.js";
import { runCli } from "./program.js";

describe("striker permissions", () => {
  it("writes the selected mode to checkout-local configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-cli-permissions-"));
    const permissionConfig = new LocalPermissionConfig(
      path.join(root, ".git-private", "permissions.json"),
    );
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["permissions", "auto-review"], {
      cwd: root,
      permissionConfig,
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text) => (stderr += text) },
      stdout: { write: (text) => (stdout += text) },
    });

    expect(exitCode).toBe(0);
    await expect(permissionConfig.read()).resolves.toBe("auto-review");
    expect(stdout).toBe("Permission mode: auto-review.\n");
    expect(stderr).toBe("");
  });

  it("rejects an unsupported mode without changing local settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-cli-permissions-"));
    const permissionConfig = new LocalPermissionConfig(
      path.join(root, ".git-private", "permissions.json"),
    );
    let stderr = "";

    const exitCode = await runCli(["permissions", "unsafe"], {
      cwd: root,
      permissionConfig,
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: ["codex"],
      },
      stderr: { write: (text) => (stderr += text) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    await expect(permissionConfig.read()).resolves.toBe("attended");
    expect(stderr).toContain(
      "Allowed choices are attended, auto-review, unattended",
    );
  });
});
