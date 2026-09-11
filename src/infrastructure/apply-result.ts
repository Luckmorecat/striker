import { realpath } from "node:fs/promises";
import type {
  ApplicationIntent,
  ApplicationState,
  ResultApplication,
} from "../core/apply-feature.js";
import { resultBranchName } from "../core/result-export.js";
import {
  lockCheckout,
  requireClean,
  requireNoObstructions,
} from "./apply-checkout.js";
import { resultGit, resultRef, resultTransaction } from "./result-git.js";

export class ApplyResult implements ResultApplication {
  constructor(private readonly root: string) {}
  async apply(
    intent: ApplicationIntent,
    state: ApplicationState | undefined,
    recordIntent: () => Promise<void>,
  ): Promise<void> {
    await this.validate(intent);
    const checkout = await lockCheckout(this.root);
    try {
      const current = await this.refs(intent);
      const alreadyApplied = current === intent.head && state !== undefined;
      if (
        !alreadyApplied &&
        (current !== intent.sourceHead || state?.status === "completed")
      )
        throw new Error(
          "Original target advanced or application mismatch; inspect source and result branches and integrate manually",
        );
      const ref = `refs/heads/${intent.sourceBranch}`;
      await resultTransaction(
        this.root,
        `update ${ref} ${intent.head} ${current}\nverify refs/heads/${intent.resultBranch} ${intent.head}\nverify refs/striker/exports/${intent.runId} ${intent.head}\n`,
        async () => {
          await this.refs(intent);
          if (alreadyApplied) {
            await requireClean(checkout.git, intent.head);
            return;
          }
          const tree = await checkout.git(["write-tree"]);
          const resultTree = await checkout.git([
            "rev-parse",
            `${intent.head}^{tree}`,
          ]);
          if (state && tree === resultTree) {
            await requireClean(checkout.git, intent.head);
          } else {
            await requireClean(checkout.git, intent.sourceHead);
            if (!state) await recordIntent();
            await requireNoObstructions(
              checkout.git,
              intent.sourceHead,
              intent.head,
            );
            // Two-tree checkout refuses local changes/obstructions; never reset.
            await checkout.git([
              "read-tree",
              "-m",
              "-u",
              intent.sourceHead,
              intent.head,
            ]);
            await requireClean(checkout.git, intent.head);
            await checkout.install();
          }
        },
      );
    } finally {
      await checkout.release();
    }
  }
  private async validate(intent: ApplicationIntent) {
    if (
      (await realpath(this.root)) !== intent.sourceRoot ||
      (await resultGit(this.root, ["rev-parse", "--show-toplevel"])) !==
        intent.sourceRoot
    )
      throw new Error(
        "Apply requires the original source repository and worktree",
      );
    if (intent.resultBranch !== resultBranchName(intent.runId))
      throw new Error("Invalid result branch ownership");
    for (const head of [intent.head, intent.sourceHead]) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))
        throw new Error("Invalid application commit identity");
    }
    await resultGit(this.root, [
      "check-ref-format",
      `refs/heads/${intent.sourceBranch}`,
    ]);
    await resultGit(this.root, [
      "merge-base",
      "--is-ancestor",
      intent.sourceHead,
      intent.head,
    ]);
  }
  private async refs(intent: ApplicationIntent) {
    if (
      (await resultGit(this.root, ["symbolic-ref", "--no-recurse", "HEAD"])) !==
      `refs/heads/${intent.sourceBranch}`
    )
      throw new Error(
        "Apply requires the original source branch; switch back before retrying",
      );
    if (
      (await resultRef(this.root, `refs/heads/${intent.resultBranch}`)) !==
        intent.head ||
      (await resultRef(this.root, `refs/striker/exports/${intent.runId}`)) !==
        intent.head
    )
      throw new Error(
        "Result branch or ownership receipt changed; restore the certified refs before apply",
      );
    return resultRef(this.root, `refs/heads/${intent.sourceBranch}`);
  }
}
