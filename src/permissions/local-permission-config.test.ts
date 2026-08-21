import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalPermissionConfig } from "./local-permission-config.js";

async function temporaryConfig(): Promise<{
  readonly config: LocalPermissionConfig;
  readonly filePath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-permissions-"));
  const filePath = path.join(root, "private", "permissions.json");
  return { config: new LocalPermissionConfig(filePath), filePath };
}

describe("checkout-local permission configuration", () => {
  it("defaults a checkout without local settings to attended", async () => {
    const { config } = await temporaryConfig();

    await expect(config.read()).resolves.toBe("attended");
  });

  it("persists an explicit local mode in an owner-only file", async () => {
    const { config, filePath } = await temporaryConfig();

    await config.write("unattended");

    await expect(config.read()).resolves.toBe("unattended");
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{\n  "approvalMode": "unattended"\n}\n',
    );
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects a malformed or unsupported local setting", async () => {
    const { config, filePath } = await temporaryConfig();
    await config.write("attended");
    await writeFile(filePath, '{"approvalMode":"dangerous"}', "utf8");

    await expect(config.read()).rejects.toThrow(
      "Cannot load local permission configuration",
    );
  });
});
