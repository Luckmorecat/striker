import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openRunConnectivity } from "./run-connectivity.js";
import { parseProjectConfig } from "../../config/project-config.js";

it("persists the selected model and host grants, refuses unavailable overrides, and removes access on close", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-connect-"));
  const broker = {
    url: "http://127.0.0.1:1",
    key: "host-secret",
    models: () => Promise.resolve(["gpt-5.6-sol", "override"]),
  };
  const config = parseProjectConfig({ taskSource: "striker-plan" });
  try {
    await expect(
      openRunConnectivity({
        root,
        broker,
        config: { ...config, model: "missing" },
        services: [],
      }),
    ).rejects.toThrow(/unavailable/);
    const services = [
      { name: "database.test", port: 5432, addresses: ["127.0.0.1"] },
    ];
    const access = await openRunConnectivity({
      root,
      broker,
      config,
      services,
    });
    expect(access.selection).toEqual({ model: "gpt-5.6-sol", effort: "low" });
    expect((await stat(access.socketPath)).mode & 0o777).toBe(0o600);
    const descriptor = await readFile(access.descriptorPath, "utf8");
    expect(JSON.parse(descriptor)).toMatchObject({
      selection: access.selection,
      services,
    });
    expect(descriptor).not.toContain(broker.key);
    expect(descriptor).not.toContain(access.token);
    await access.close();
    await expect(stat(access.socketPath)).rejects.toThrow();
    const override = await openRunConnectivity({
      root,
      broker,
      config: { ...config, model: "override", reasoningEffort: "high" },
      services: [],
    });
    expect(override.selection).toEqual({ model: "override", effort: "high" });
    await override.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
