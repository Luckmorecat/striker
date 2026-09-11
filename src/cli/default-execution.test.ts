import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
it("defaults to Docker, persists explicit local selection, and never falls back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-default-"));
  await exec("git", ["init", root]);
  await writeFile(
    path.join(root, "striker.config.json"),
    '{"taskSource":"striker-plan"}',
  );
  const cli = (...args: string[]) =>
    exec(
      process.execPath,
      [
        fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
        "run",
        "missing-plan",
        "--no-interactive",
        ...args,
      ],
      { cwd: root },
    ).catch((error: unknown) => error as { stdout: string; stderr: string });
  const initial = await cli("--allow-dirty");
  expect(initial.stderr).toContain(
    "--allow-dirty is available only for local execution",
  );
  expect(initial.stderr).not.toContain("personal");
  const local = await cli("--execution", "local", "--allow-dirty");
  expect(local.stderr).toContain("host access");
  expect(local.stderr).toContain("personal");
  expect(
    JSON.parse(
      await readFile(path.join(root, ".git/striker/execution.json"), "utf8"),
    ),
  ).toMatchObject({ backend: "local" });
  expect((await cli("--allow-dirty")).stderr).toContain("host access");
  expect(
    (await cli("--execution", "docker", "--allow-dirty")).stderr,
  ).toContain("only for local");
  expect((await cli("--allow-dirty")).stderr).toContain("only for local");
});
