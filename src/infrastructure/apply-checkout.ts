import { copyFile, mkdtemp, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { resultGit } from "./result-git.js";

/** Disable every locally configured conversion driver before inspecting or writing task trees. */
async function conversionOptions(root: string) {
  const names = await resultGit(root, [
    "config",
    "--name-only",
    "--get-regexp",
    "^filter\\.",
  ]).catch((error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error && "code" in cause && cause.code === 1)
      return "";
    throw error;
  });
  const drivers = new Set(
    names
      .split("\n")
      .filter(Boolean)
      .map((name) => name.slice(0, name.lastIndexOf("."))),
  );
  return [...drivers].flatMap((driver) => [
    "-c",
    `${driver}.clean=`,
    "-c",
    `${driver}.smudge=`,
    "-c",
    `${driver}.process=`,
    "-c",
    `${driver}.required=false`,
  ]);
}
export function checkoutGit(root: string, indexFile?: string) {
  return async (args: readonly string[]) =>
    resultGit(
      root,
      [
        ...(await conversionOptions(root)),
        "-c",
        `core.worktree=${root}`,
        "-c",
        "submodule.recurse=false",
        "-c",
        "core.sparseCheckout=false",
        "-c",
        "core.ignorestat=false",
        ...args,
      ],
      undefined,
      indexFile,
    );
}
export async function lockCheckout(root: string) {
  const index = await resultGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const temporary = await mkdtemp(
    path.join(path.dirname(index), "striker-apply-"),
  );
  const indexLock = await open(`${index}.lock`, "wx", 0o600).catch(
    async (error: unknown) => {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    },
  );
  const staged = path.join(temporary, "index");
  let git;
  try {
    await copyFile(index, staged);
    git = checkoutGit(root, staged);
  } catch (error) {
    await release();
    throw error;
  }
  async function release() {
    await indexLock.close();
    await rm(`${index}.lock`, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    git,
    async install() {
      // Keep the real index lock held until the ref transaction finishes.
      await copyFile(staged, path.join(temporary, "installed"));
      const installed = await open(path.join(temporary, "installed"), "r");
      try {
        await installed.sync();
      } finally {
        await installed.close();
      }
      await rename(path.join(temporary, "installed"), index);
    },
    release,
  };
}
export async function requireClean(
  git: (args: readonly string[]) => Promise<string>,
  head: string,
) {
  const flags = await git(["ls-files", "-v", "-z"]);
  if (flags.split("\0").some((entry) => /^[a-zS]/.test(entry)))
    throw new Error(
      "Apply refuses sparse, skip-worktree or assume-unchanged index entries; restore a full ordinary checkout",
    );
  try {
    await git(["update-index", "--really-refresh"]);
    await git(["diff-index", "--cached", "--quiet", head, "--"]);
    await git(["diff-files", "--quiet", "--"]);
    if (await git(["ls-files", "--others", "--exclude-standard", "-z"]))
      throw new Error("untracked files");
  } catch (cause) {
    throw new Error(
      "Source checkout/index is dirty or application state is ambiguous; inspect git status and preserve your changes before retrying apply",
      { cause },
    );
  }
}

/** Git permits overwriting ignored files; protect them before two-tree checkout. */
export async function requireNoObstructions(
  git: (args: readonly string[]) => Promise<string>,
  before: string,
  after: string,
) {
  const changes = (
    await git([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      before,
      after,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const others = (await git(["ls-files", "--others", "--directory", "-z"]))
    .split("\0")
    .filter(Boolean)
    .map((name) => name.replace(/\/$/, ""));
  if (
    others.some((other) =>
      changes.some(
        (changed) =>
          other === changed ||
          other.startsWith(`${changed}/`) ||
          changed.startsWith(`${other}/`),
      ),
    )
  )
    throw new Error(
      "An ignored or untracked source path obstructs the result; move it aside explicitly before apply",
    );
}
