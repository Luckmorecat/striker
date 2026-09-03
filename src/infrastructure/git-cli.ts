import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { GitRepository, GitState } from "../core/contracts.js";

const execFileAsync = promisify(execFile);

async function git(
  root: string,
  arguments_: readonly string[],
): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

function splitNull(value: string): string[] {
  return value.split("\0").filter((item) => item.length > 0);
}

async function untrackedHashes(
  root: string,
  files: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all(
    [...files].sort().map(
      async (file) =>
        [
          file,
          createHash("sha256")
            .update(await readFile(path.join(root, file)))
            .digest("hex"),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

export class GitCliRepository implements GitRepository {
  async changedPaths(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<readonly string[]> {
    return splitNull(
      await git(root, [
        "diff",
        "--name-only",
        "-z",
        ancestor,
        descendant,
        "--",
      ]),
    ).sort();
  }

  async inspect(location: string): Promise<GitState> {
    const root = await this.resolveRoot(location);
    const [head, patch, trackedOutput, untrackedOutput] = await Promise.all([
      git(root, ["rev-parse", "HEAD"]),
      git(root, ["diff", "--binary", "HEAD", "--"]),
      git(root, ["diff", "--name-only", "-z", "HEAD", "--"]),
      git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const tracked = splitNull(trackedOutput);
    const untracked = splitNull(untrackedOutput);
    return {
      dirtyPaths: [...new Set([...tracked, ...untracked])].sort(),
      head: head.trim(),
      root,
      trackedPatch: patch,
      untrackedHashes: await untrackedHashes(root, untracked),
    };
  }

  async readFileAtCommit(
    root: string,
    commit: string,
    file: string,
  ): Promise<string | null> {
    try {
      return await git(root, ["cat-file", "blob", `${commit}:${file}`]);
    } catch {
      return null;
    }
  }

  async commitsBetween(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<readonly string[]> {
    try {
      await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    } catch {
      return [];
    }
    return (
      await git(root, ["rev-list", "--reverse", `${ancestor}..${descendant}`])
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  }

  async isAncestor(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    try {
      await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  async resolveRoot(location: string): Promise<string> {
    return (await git(location, ["rev-parse", "--show-toplevel"])).trim();
  }

  async resolvePrivatePath(root: string, name: string): Promise<string> {
    const value = (await git(root, ["rev-parse", "--git-path", name])).trim();
    return path.isAbsolute(value) ? value : path.resolve(root, value);
  }
}
