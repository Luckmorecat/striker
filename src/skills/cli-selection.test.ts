import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

it.each([
  {
    name: "prefers local",
    local: "success",
    global: true,
    status: 0,
    output: "local:path with spaces\n",
    error: "",
  },
  {
    name: "falls back to PATH when local is absent",
    local: "absent",
    global: true,
    status: 0,
    output: "global:path with spaces\n",
    error: "",
  },
  {
    name: "preserves local failure",
    local: "failure",
    global: true,
    status: 42,
    output: "",
    error: "local failure",
  },
  {
    name: "reports a missing installation",
    local: "absent",
    global: false,
    status: 127,
    output: "",
    error: "npm install --global @useless_mob/striker",
  },
])("$name", async (scenario) => {
  const root = await mkdtemp(path.join(tmpdir(), "striker selection "));
  try {
    const reference = await readFile(
      new URL("../../skills/striker/CLI.md", import.meta.url),
      "utf8",
    );
    const procedure = /```sh\n([\s\S]*?)```/u.exec(reference)?.[1];
    if (procedure === undefined)
      throw new Error("Missing CLI selection procedure");
    const localBin = path.join(root, "node_modules/.bin");
    const globalBin = path.join(root, "bin");
    await mkdir(localBin, { recursive: true });
    await mkdir(globalBin);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    expect(spawnSync("git", ["init", "--quiet", root]).status).toBe(0);
    if (scenario.global)
      await writeFile(
        path.join(globalBin, "striker"),
        '#!/bin/sh\nprintf "global:%s\\n" "$@"\n',
        { mode: 0o755 },
      );
    if (scenario.local === "success")
      await writeFile(
        path.join(localBin, "striker"),
        '#!/bin/sh\nprintf "local:%s\\n" "$@"\n',
        { mode: 0o755 },
      );
    if (scenario.local === "failure")
      await writeFile(
        path.join(localBin, "striker"),
        '#!/bin/sh\necho "local failure" >&2\nexit 42\n',
        { mode: 0o755 },
      );
    const git = spawnSync("/bin/sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).stdout.trim();
    await symlink(git, path.join(globalBin, "git"));
    const result = spawnSync(
      "/bin/sh",
      ["-c", `${procedure}\nrun_striker "$@"`, "test", "path with spaces"],
      {
        cwd: nested,
        env: { ...process.env, PATH: globalBin },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(scenario.status);
    expect(result.stdout).toBe(scenario.output);
    expect(result.stderr).toContain(scenario.error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
