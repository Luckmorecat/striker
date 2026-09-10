import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LocalExecutionConfig } from "./local-execution-config.js";

it("keeps image approval and resource overrides in private local configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-policy-"));
  const file = path.join(root, "execution.json");
  const config = new LocalExecutionConfig(file);
  expect(await config.read()).toEqual({
    approvedImages: [],
    resources: { cpus: 4, memoryMiB: 8192, pids: 512 },
  });
  const image = `sha256:${"b".repeat(64)}`;
  await config.write({
    approvedImages: [image],
    resources: { cpus: 2, memoryMiB: 2048, pids: 64 },
  });
  expect((await new LocalExecutionConfig(file).read()).approvedImages).toEqual([
    image,
  ]);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readFile(file, "utf8")).toContain('"cpus": 2');
  await writeFile(file, '{"resources":{"cpus":0}}');
  await expect(config.read()).rejects.toThrow();
});
