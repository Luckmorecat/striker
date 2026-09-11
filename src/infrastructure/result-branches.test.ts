import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ResultBranches } from "./result-branches.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-export-"));
  const host = path.join(root, "host");
  const worker = path.join(root, "worker");
  await mkdir(host);
  const git = async (cwd: string, ...args: string[]) =>
    (await promisify(execFile)("git", ["-C", cwd, ...args])).stdout.trim();
  await git(host, "init", "-b", "main");
  await git(host, "config", "user.name", "Test");
  await git(host, "config", "user.email", "test@localhost");
  await writeFile(path.join(host, "file"), "base");
  await git(host, "add", ".");
  await git(host, "commit", "-m", "base");
  const start = await git(host, "rev-parse", "HEAD");
  await git(root, "clone", "--no-local", host, worker);
  await git(worker, "config", "user.name", "Test");
  await git(worker, "config", "user.email", "test@localhost");
  const commit = async (content: string) => {
    await writeFile(path.join(worker, "file"), content);
    await git(worker, "commit", "-am", content);
    return git(worker, "rev-parse", "HEAD");
  };
  const pack = (head: string) =>
    new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        "git",
        ["-C", worker, "pack-objects", "--stdout", "--revs"],
        { encoding: "buffer" },
        (error, stdout) => {
          if (error) reject(new Error(error.message, { cause: error }));
          else resolve(stdout);
        },
      );
      child.stdin?.end(`${head}\n`);
    });
  const exporter = new ResultBranches(host, pack);
  const intent = (
    resultCommit: string,
    previousHead: string | null = null,
  ) => ({
    runId: "test",
    branch: "codex/striker-test",
    startCommit: previousHead ?? start,
    previousHead,
    resultCommit,
  });
  return { root, host, worker, git, start, commit, exporter, intent };
}
it("imports only certified commits incrementally without touching source or running hooks", async () => {
  const f = await fixture();
  try {
    const one = await f.commit("one");
    const two = await f.commit("two");
    const sentinel = path.join(f.root, "hook-ran");
    const hooks = path.join(f.root, "hooks");
    await mkdir(hooks);
    await writeFile(
      path.join(hooks, "reference-transaction"),
      `#!/bin/sh\ntouch '${sentinel}'\n`,
      { mode: 0o755 },
    );
    await f.git(f.host, "config", "core.hooksPath", hooks);
    await f.exporter.export(f.intent(one));
    expect(await f.git(f.host, "rev-parse", "codex/striker-test")).toBe(one);
    await f.exporter.export(f.intent(one)); // ref changed before completion journal append
    await f.exporter.export(f.intent(two, one));
    expect(
      await f.git(
        f.host,
        "log",
        "--format=%s",
        `${f.start}..codex/striker-test`,
      ),
    ).toBe("two\none");
    expect(await f.git(f.host, "rev-parse", "HEAD")).toBe(f.start);
    expect(await f.git(f.host, "status", "--porcelain")).toBe("");
    await expect(access(sentinel)).rejects.toThrow();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("refuses collisions, user divergence, symbolic refs and checked-out result branches", async () => {
  const f = await fixture();
  try {
    const one = await f.commit("one");
    const two = await f.commit("two");
    const ref = "refs/heads/codex/striker-test";
    await f.git(f.host, "branch", "codex/striker-test");
    await expect(f.exporter.export(f.intent(one))).rejects.toThrow(
      /collision|divergence/,
    );
    await f.git(f.host, "branch", "-D", "codex/striker-test");
    await f.exporter.export(f.intent(one));
    await f.git(f.host, "update-ref", ref, f.start);
    await expect(f.exporter.export(f.intent(two, one))).rejects.toThrow(
      /divergence/,
    );
    expect(await f.git(f.host, "rev-parse", ref)).toBe(f.start);
    await f.git(f.host, "symbolic-ref", ref, "refs/heads/main");
    await expect(f.exporter.export(f.intent(two, one))).rejects.toThrow(
      /symbolic/,
    );
    expect(await f.git(f.host, "rev-parse", "main")).toBe(f.start);
    await f.git(f.host, "symbolic-ref", "--delete", ref);
    await f.git(f.host, "update-ref", ref, one);
    await f.git(f.host, "checkout", "codex/striker-test");
    await expect(f.exporter.export(f.intent(two, one))).rejects.toThrow(
      /checked out/,
    );
    expect(await f.git(f.host, "rev-parse", "HEAD")).toBe(one);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("rejects uncertified ancestry and malformed transfer before creating a ref", async () => {
  const f = await fixture();
  try {
    await f.commit("one");
    const two = await f.commit("two");
    await expect(f.exporter.export(f.intent(two))).rejects.toThrow(
      /single certified descendant/,
    );
    await expect(
      new ResultBranches(f.host, () =>
        Promise.resolve(Buffer.from("not a pack")),
      ).export(f.intent(two)),
    ).rejects.toThrow();
    await expect(
      f.exporter.export({ ...f.intent(two), resultCommit: "--all" }),
    ).rejects.toThrow(/identity/);
    await expect(
      f.exporter.export({ ...f.intent(two), branch: "main" }),
    ).rejects.toThrow(/belong/);
    expect(await f.git(f.host, "branch", "--list", "codex/striker-test")).toBe(
      "",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("recovers a crash after reserving ownership but before advancing the result ref", async () => {
  const f = await fixture();
  try {
    const one = await f.commit("one");
    await f.git(f.host, "fetch", f.worker, one);
    // Simulate the durable prefix of a two-phase export interrupted by SIGKILL.
    await f.git(f.host, "update-ref", "refs/striker/exports/test", one);
    await f.exporter.export(f.intent(one));
    expect(await f.git(f.host, "rev-parse", "codex/striker-test")).toBe(one);
    expect(await f.git(f.host, "rev-parse", "HEAD")).toBe(f.start);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("refuses to import into a host repository that lost the recorded source ancestry", async () => {
  const f = await fixture();
  try {
    const one = await f.commit("one");
    await rm(path.join(f.host, ".git"), { recursive: true });
    await f.git(f.host, "init", "-b", "replacement");
    await expect(f.exporter.export(f.intent(one))).rejects.toThrow(
      /source ancestry/,
    );
    expect(await f.git(f.host, "branch", "--list", "codex/striker-test")).toBe(
      "",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
