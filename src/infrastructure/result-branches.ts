import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resultBranchName,
  type CertifiedExport,
  type ResultExporter,
} from "../core/result-export.js";
import { resultGit, resultRef, resultTransaction } from "./result-git.js";

export class ResultBranches implements ResultExporter {
  constructor(
    private readonly projectRoot: string,
    private readonly pack: (head: string) => Promise<Uint8Array>,
  ) {}

  async export(intent: CertifiedExport): Promise<void> {
    validateIntent(intent);
    await requireHostAncestry(this.projectRoot, intent.startCommit);
    const ref = `refs/heads/${intent.branch}`;
    const receipt = `refs/striker/exports/${intent.runId}`;
    if (await this.alreadyExported(intent, ref, receipt)) return;
    const bytes = await this.pack(intent.resultCommit);
    await validatePack(bytes, intent);
    await resultGit(
      this.projectRoot,
      ["index-pack", "--stdin", "--strict"],
      bytes,
    );
    // Recheck immediately before compare-and-swap; never check out imported trees.
    if (await this.alreadyExported(intent, ref, receipt)) return;
    const previous =
      intent.previousHead ?? "0".repeat(intent.resultCommit.length);
    if ((await resultRef(this.projectRoot, receipt)) !== intent.resultCommit) {
      await resultTransaction(
        this.projectRoot,
        `verify ${ref} ${previous}\nupdate ${receipt} ${intent.resultCommit} ${previous}\n`,
        async () => {
          await this.alreadyExported(intent, ref, receipt);
        },
      );
    }
    // Only one ref mutates per transaction: a crash between file-ref renames
    // cannot leave an advanced branch without its durable ownership receipt.
    await resultTransaction(
      this.projectRoot,
      `update ${ref} ${intent.resultCommit} ${previous}\nverify ${receipt} ${intent.resultCommit}\n`,
      async () => {
        await this.alreadyExported(intent, ref, receipt);
      },
    );
  }

  private async alreadyExported(
    intent: CertifiedExport,
    ref: string,
    receipt: string,
  ): Promise<boolean> {
    const worktrees = await resultGit(this.projectRoot, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    if (worktrees.split("\n").includes(`branch ${ref}`))
      throw new Error(
        "Result branch is checked out; switch that worktree to another branch before export",
      );
    const head = await resultRef(this.projectRoot, ref);
    const recorded = await resultRef(this.projectRoot, receipt);
    if (head === intent.resultCommit && recorded === head) return true;
    if (
      head !== intent.previousHead ||
      (recorded !== intent.previousHead && recorded !== intent.resultCommit)
    )
      throw new Error(
        "Result branch collision or user divergence; refusing to overwrite the ref",
      );
    return false;
  }
}
async function requireHostAncestry(root: string, head: string): Promise<void> {
  try {
    if ((await resultGit(root, ["cat-file", "-t", head])) !== "commit")
      throw new Error("Expected a commit");
  } catch (cause) {
    throw new Error(
      "Original host source ancestry is missing; restore the original repository before export",
      { cause },
    );
  }
}
function validateIntent(intent: CertifiedExport): void {
  if (intent.branch !== resultBranchName(intent.runId))
    throw new Error("Result branch does not belong to the run");
  for (const head of [
    intent.startCommit,
    intent.resultCommit,
    intent.previousHead ?? intent.startCommit,
  ]) {
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) ||
      head.length !== intent.resultCommit.length
    )
      throw new Error("Invalid certified commit identity");
  }
  if (
    intent.previousHead !== null &&
    intent.previousHead !== intent.startCommit
  )
    throw new Error("Certified export does not extend its previous result");
}
async function validatePack(
  bytes: Uint8Array,
  intent: CertifiedExport,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-result-"));
  try {
    await resultGit(root, [
      "init",
      "--bare",
      "--template=",
      `--object-format=${intent.resultCommit.length === 40 ? "sha1" : "sha256"}`,
    ]);
    await resultGit(root, ["index-pack", "--stdin", "--strict"], bytes);
    await resultGit(root, [
      "fsck",
      "--strict",
      "--no-reflogs",
      intent.resultCommit,
    ]);
    const parents = await resultGit(root, [
      "rev-list",
      "--parents",
      "--max-count=1",
      intent.resultCommit,
      "--",
    ]);
    if (parents !== `${intent.resultCommit} ${intent.startCommit}`)
      throw new Error(
        "Transferred result is not the single certified descendant commit",
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
