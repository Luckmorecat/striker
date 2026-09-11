import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { recoveryFixture, fakeBroker } from "./recovery-fixture.js";
import { fakeResponses } from "./fake-responses.js";

test("default execution fails actionably on missing prerequisites without host fallback", async () => {
  const original = await recoveryFixture("codex");
  const stateRoot = path.join(original.source, ".git/striker");
  await rename(original.stateRoot, stateRoot);
  const f = { ...original, stateRoot };
  const fake = await fakeResponses();
  const config = path.join(f.source, "striker.config.json");
  const configure = async (harness: string) => {
    await writeFile(
      config,
      JSON.stringify({ taskSource: "striker-plan", harness }),
    );
    await f.git("add", ".");
    await f.git("commit", "--allow-empty", "-m", "configure");
  };
  const cli = () =>
    promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
        "run",
        f.plan,
        "--no-interactive",
      ],
      {
        cwd: f.source,
        env: {
          ...process.env,
          DOCKER_HOST: `unix://${f.root}/missing.sock`,
          DOCKER_CONTEXT: "",
        },
      },
    ).then(
      () => {
        throw new Error("Expected prerequisite failure");
      },
      (error: unknown) => (error as { stderr: string }).stderr,
    );
  try {
    await configure("claude");
    expect(await cli()).toContain(
      "Docker execution supports only Codex and Pi",
    );
    await configure("codex");
    const prepared = path.join(stateRoot, "prepared-image.json");
    const image = await readFile(prepared);
    await rm(prepared);
    expect(await cli()).toContain("striker environment prepare");
    await writeFile(prepared, image);
    expect(await cli()).toContain("striker auth prepare");
    await fakeBroker(f, fake.url);
    expect(await cli()).toContain("Docker is unavailable");
    expect((await f.git("status", "--porcelain")).stdout).toBe("");
    expect(fake.errors).toEqual([]);
  } finally {
    await fake.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 300_000);
