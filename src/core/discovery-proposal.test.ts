import { describe, expect, it } from "vitest";

import type { GitRepository, GitState } from "./contracts.js";
import { resolveDiscoveryProposals } from "./discovery-proposal.js";

class EvidenceGit implements GitRepository {
  changedPaths(): Promise<readonly string[]> {
    throw new Error("Unexpected changed-path query");
  }

  commitsBetween(): Promise<readonly string[]> {
    throw new Error("Unexpected commit query");
  }

  inspect(): Promise<GitState> {
    throw new Error("Unexpected inspection");
  }

  readFileAtCommit(
    root: string,
    commit: string,
    path: string,
  ): Promise<string | null> {
    expect({ commit, path, root }).toEqual({
      commit: "candidate",
      path: "src/task.ts",
      root: "/repo",
    });
    return Promise.resolve("first line\nexport const owner = 'core';\n");
  }

  resolvePrivatePath(): Promise<string> {
    throw new Error("Unexpected private-path query");
  }

  resolveRoot(): Promise<string> {
    throw new Error("Unexpected root query");
  }
}

const execution = {
  after: {
    dirtyPaths: [],
    head: "candidate",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  },
  before: {
    dirtyPaths: [],
    head: "baseline",
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  },
  changedPaths: ["src/task.ts"],
  commits: ["candidate"],
  verification: {
    command: "pnpm check",
    exitCode: 0,
    output: "235 tests passed",
  },
} as const;

describe("discovery proposal evidence", () => {
  it("resolves code and verification locators against stored candidate evidence", async () => {
    const proposals = [
      {
        id: "A1",
        kind: "assumption",
        locator: {
          kind: "code",
          line: 2,
          path: "src/task.ts",
          text: "export const owner = 'core';",
        },
        reason: "Core owns this value.",
        state: "confirmed",
      },
      {
        deviation: "Keep the existing command name.",
        id: "D1",
        kind: "default",
        locator: {
          command: "pnpm check",
          exitCode: 0,
          kind: "verification",
          output: "235 tests passed",
        },
      },
    ] as const;

    await expect(
      resolveDiscoveryProposals(proposals, execution, new EvidenceGit()),
    ).resolves.toEqual([
      {
        ...proposals[0],
        locator: { ...proposals[0].locator, commit: "candidate" },
      },
      { ...proposals[1], locator: proposals[1].locator },
    ]);
  });
});

describe("invalid discovery proposal evidence", () => {
  it("rejects missing, mismatched, and unchecked citations", async () => {
    const git = new EvidenceGit();
    await expect(
      resolveDiscoveryProposals(
        [
          {
            id: "A1",
            kind: "assumption",
            locator: {
              kind: "code",
              line: 3,
              path: "src/task.ts",
              text: "missing",
            },
            reason: "The line is absent.",
            state: "disproved",
          },
        ],
        execution,
        git,
      ),
    ).rejects.toThrow("does not match candidate");
    await expect(
      resolveDiscoveryProposals(
        [
          {
            deviation: "Use a focused check.",
            id: "D1",
            kind: "default",
            locator: {
              command: "pnpm test",
              exitCode: 0,
              kind: "verification",
              output: "passed",
            },
          },
        ],
        execution,
        git,
      ),
    ).rejects.toThrow("does not match stored verification");
    await expect(
      resolveDiscoveryProposals([], execution, undefined),
    ).resolves.toEqual([]);
  });
});
