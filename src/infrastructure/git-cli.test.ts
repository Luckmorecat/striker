import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { GitCliRepository } from "./git-cli.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...arguments_: string[]): Promise<string> {
  return (
    await execFileAsync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
    })
  ).stdout;
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-git-"));
  await git(root, "init");
  await git(root, "config", "user.email", "striker@example.test");
  await git(root, "config", "user.name", "Striker Test");
  await writeFile(path.join(root, "tracked.txt"), "initial\n");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "-m", "initial");
  return root;
}

describe("Git CLI repository", () => {
  it("captures tracked patches and hashes untracked files", async () => {
    const root = await repository();
    await writeFile(path.join(root, "tracked.txt"), "changed\n");
    await writeFile(path.join(root, "untracked.txt"), "new\n");

    const state = await new GitCliRepository().inspect(root);

    expect(state.dirtyPaths).toEqual(["tracked.txt", "untracked.txt"]);
    expect(state.trackedPatch).toContain("+changed");
    expect(state.untrackedHashes["untracked.txt"]).toMatch(/^[a-f\d]{64}$/);
  });

  it("proves a single descendant commit", async () => {
    const root = await repository();
    const repositoryAdapter = new GitCliRepository();
    const before = await repositoryAdapter.inspect(root);
    await writeFile(path.join(root, "tracked.txt"), "committed\n");
    await git(root, "add", "tracked.txt");
    await git(root, "commit", "-m", "change");
    const after = await repositoryAdapter.inspect(root);

    await expect(
      repositoryAdapter.commitsBetween(root, before.head, after.head),
    ).resolves.toEqual([after.head]);
    await expect(
      repositoryAdapter.isAncestor(root, before.head, after.head),
    ).resolves.toBe(true);
    await expect(
      repositoryAdapter.isAncestor(root, after.head, before.head),
    ).resolves.toBe(false);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    await expect(repositoryAdapter.resolveRoot(nested)).resolves.toBe(
      await realpath(root),
    );
  });

  it("lists paths changed between exact commits", async () => {
    const root = await repository();
    const repositoryAdapter = new GitCliRepository();
    const before = await repositoryAdapter.inspect(root);
    await writeFile(path.join(root, "tracked.txt"), "committed\n");
    await writeFile(path.join(root, "added.txt"), "added\n");
    await git(root, "add", "tracked.txt", "added.txt");
    await git(root, "commit", "-m", "change two files");
    const after = await repositoryAdapter.inspect(root);

    await expect(
      repositoryAdapter.changedPaths(root, before.head, after.head),
    ).resolves.toEqual(["added.txt", "tracked.txt"]);
    await expect(
      repositoryAdapter.readFileAtCommit(root, before.head, "tracked.txt"),
    ).resolves.toBe("initial\n");
    await expect(
      repositoryAdapter.readFileAtCommit(root, after.head, "tracked.txt"),
    ).resolves.toBe("committed\n");
    await expect(
      repositoryAdapter.readFileAtCommit(root, after.head, "missing.txt"),
    ).resolves.toBeNull();
  });
});
