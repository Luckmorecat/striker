import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { resultGit } from "./result-git.js";
import { ApplyResult } from "./apply-result.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-apply-"));
  const git = (...args: string[]) => resultGit(root, args);
  await git("init", "-b", "main", "--template=");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@localhost");
  const commits: string[] = [];
  for (const value of ["A", "B", "C", "D"]) {
    await writeFile(path.join(root, "file"), value);
    await git("add", ".");
    await git("commit", "-m", value);
    commits.push(await git("rev-parse", "HEAD"));
  }
  const sourceHead = commits[0] ?? "";
  const head = commits[3] ?? "";
  await git("branch", "codex/striker-test");
  await git("update-ref", "refs/striker/exports/test", head);
  await git("checkout", "-b", "original", sourceHead);
  const intent = {
    runId: "test",
    sourceRoot: root,
    sourceBranch: "original",
    sourceHead,
    resultBranch: "codex/striker-test",
    head,
  };
  return { root, git, intent, commits };
}
it("explicitly advances A to D preserving B and C and repeats only with recorded intent", async () => {
  const f = await fixture();
  try {
    let recorded = false;
    await new ApplyResult(f.root).apply(f.intent, undefined, () => {
      recorded = true;
      return Promise.resolve();
    });
    expect(recorded).toBe(true);
    expect(await f.git("rev-list", "--reverse", "HEAD")).toBe(
      f.commits.join("\n"),
    );
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("D");
    expect(await f.git("status", "--porcelain")).toBe("");
    await new ApplyResult(f.root).apply(
      f.intent,
      { head: f.intent.head, status: "completed" },
      () => {
        throw new Error("duplicate intent");
      },
    );
    await expect(
      new ApplyResult(f.root).apply(f.intent, undefined, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/advanced|mismatch/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("refuses dirty files/index, branch changes, advanced targets and tampered results without altering work", async () => {
  const f = await fixture();
  const apply = () =>
    new ApplyResult(f.root).apply(f.intent, undefined, () => Promise.resolve());
  try {
    await writeFile(path.join(f.root, "file"), "user edit");
    await expect(apply()).rejects.toThrow(/dirty/);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("user edit");
    await f.git("add", "file");
    await expect(apply()).rejects.toThrow(/dirty/);
    await f.git("restore", "--source=HEAD", "--staged", "--worktree", "file");
    await writeFile(path.join(f.root, "untracked"), "keep");
    await expect(apply()).rejects.toThrow(/dirty/);
    await rm(path.join(f.root, "untracked"));
    await f.git("checkout", "main");
    await expect(apply()).rejects.toThrow(/original source branch/);
    await f.git("checkout", "original");
    await f.git("update-ref", "refs/heads/original", f.commits[1] ?? "");
    await expect(apply()).rejects.toThrow(/advanced/);
    await f.git("update-ref", "refs/heads/original", f.intent.sourceHead);
    await f.git(
      "update-ref",
      "refs/heads/codex/striker-test",
      f.commits[1] ?? "",
    );
    await expect(apply()).rejects.toThrow(/Result branch/);
    await f.git("update-ref", "refs/heads/codex/striker-test", f.intent.head);
    await f.git("symbolic-ref", "refs/striker/exports/test", "refs/heads/main");
    await expect(apply()).rejects.toThrow(/symbolic/);
    expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.sourceHead);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("A");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("locks source, HEAD, results and index during intent recording and preserves a concurrent edit", async () => {
  const f = await fixture();
  try {
    await expect(
      new ApplyResult(f.root).apply(f.intent, undefined, async () => {
        await expect(
          f.git("update-ref", "refs/heads/original", f.commits[1] ?? ""),
        ).rejects.toThrow(/lock/);
        await expect(
          f.git("symbolic-ref", "HEAD", "refs/heads/main"),
        ).rejects.toThrow(/lock/);
        await expect(
          f.git(
            "update-ref",
            "refs/heads/codex/striker-test",
            f.commits[1] ?? "",
          ),
        ).rejects.toThrow(/lock/);
        await expect(f.git("add", "file")).rejects.toThrow(/lock/);
        await writeFile(path.join(f.root, "file"), "concurrent user edit");
      }),
    ).rejects.toThrow();
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe(
      "concurrent user edit",
    );
    expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.sourceHead);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("requires the original worktree and refuses concealed index changes", async () => {
  const f = await fixture();
  try {
    await expect(
      new ApplyResult(f.root).apply(
        { ...f.intent, sourceRoot: "/another/repo" },
        undefined,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/original source/);
    await f.git("update-index", "--assume-unchanged", "file");
    await writeFile(path.join(f.root, "file"), "hidden edit");
    await expect(
      new ApplyResult(f.root).apply(f.intent, undefined, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/assume-unchanged/);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe(
      "hidden edit",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("recovers installed checkout after a fault before ref commit, but refuses a partial checkout", async () => {
  const f = await fixture();
  const rename = fs.rename;
  try {
    const fault = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (from, to) => {
        await rename(from, to);
        throw new Error("lost process after index install");
      });
    await expect(
      new ApplyResult(f.root).apply(f.intent, undefined, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/lost process/);
    fault.mockRestore();
    expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.sourceHead);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("D");
    await writeFile(
      path.join(f.root, "file"),
      "user changed interrupted checkout",
    );
    await expect(
      new ApplyResult(f.root).apply(
        f.intent,
        { head: f.intent.head, status: "started" },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/ambiguous/);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe(
      "user changed interrupted checkout",
    );
    await writeFile(path.join(f.root, "file"), "D");
    await new ApplyResult(f.root).apply(
      f.intent,
      { head: f.intent.head, status: "started" },
      () => Promise.resolve(),
    );
    expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.head);
    expect(await f.git("status", "--porcelain")).toBe("");
  } finally {
    vi.restoreAllMocks();
    await rm(f.root, { recursive: true, force: true });
  }
});
it("leaves a pre-install checkout fault actionable without resetting any files", async () => {
  const f = await fixture();
  try {
    vi.spyOn(fs, "rename").mockRejectedValue(
      new Error("index installation failed"),
    );
    await expect(
      new ApplyResult(f.root).apply(f.intent, undefined, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/installation failed/);
    vi.restoreAllMocks();
    await expect(
      new ApplyResult(f.root).apply(
        f.intent,
        { head: f.intent.head, status: "started" },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/ambiguous/);
    expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.sourceHead);
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("D");
  } finally {
    vi.restoreAllMocks();
    await rm(f.root, { recursive: true, force: true });
  }
});
it("does not run task-selected host filters, hooks or fsmonitor during application", async () => {
  const f = await fixture();
  try {
    await f.git("checkout", "main");
    await writeFile(path.join(f.root, ".gitattributes"), "file filter=trap\n");
    await f.git("add", ".gitattributes");
    await f.git("commit", "-m", "attributes");
    const head = await f.git("rev-parse", "HEAD");
    await f.git("update-ref", "refs/heads/codex/striker-test", head);
    await f.git("update-ref", "refs/striker/exports/test", head);
    await f.git("checkout", "original");
    const sentinel = path.join(f.root, ".git", "helper-ran");
    const script = path.join(f.root, ".git", "trap");
    await writeFile(script, `#!/bin/sh\ntouch '${sentinel}'\ncat\n`, {
      mode: 0o755,
    });
    await fs.mkdir(path.join(f.root, ".git", "hooks"));
    await fs.copyFile(
      script,
      path.join(f.root, ".git", "hooks", "reference-transaction"),
    );
    await f.git("config", "core.fsmonitor", script);
    await f.git("config", "filter.trap.smudge", script);
    await f.git("config", "filter.trap.clean", script);
    await f.git("config", "filter.trap.process", script);
    await f.git("config", "filter.trap.required", "true");
    await new ApplyResult(f.root).apply({ ...f.intent, head }, undefined, () =>
      Promise.resolve(),
    );
    await expect(fs.access(sentinel)).rejects.toThrow();
    expect(await readFile(path.join(f.root, "file"), "utf8")).toBe("D");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it.each(["generated", " generated"])(
  "preserves ignored files that obstruct newly tracked result paths (%s)",
  async (name) => {
    const f = await fixture();
    try {
      await f.git("checkout", "main");
      await writeFile(path.join(f.root, name), "task result");
      await f.git("add", name);
      await f.git("commit", "-m", "generated");
      const head = await f.git("rev-parse", "HEAD");
      await f.git("update-ref", "refs/heads/codex/striker-test", head);
      await f.git("update-ref", "refs/striker/exports/test", head);
      await f.git("checkout", "original");
      await fs.mkdir(path.join(f.root, ".git", "info"), { recursive: true });
      await writeFile(
        path.join(f.root, ".git", "info", "exclude"),
        `${name}\n`,
      );
      await writeFile(path.join(f.root, name), "user ignored file");
      await expect(
        new ApplyResult(f.root).apply({ ...f.intent, head }, undefined, () =>
          Promise.resolve(),
        ),
      ).rejects.toThrow();
      expect(await readFile(path.join(f.root, name), "utf8")).toBe(
        "user ignored file",
      );
      expect(await f.git("rev-parse", "HEAD")).toBe(f.intent.sourceHead);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
it("does not execute filters introduced by a task-controlled Git config include", async () => {
  const f = await fixture();
  try {
    const sentinel = path.join(f.root, ".git", "included-helper-ran");
    const script = path.join(f.root, ".git", "included-trap");
    await writeFile(script, `#!/bin/sh\ntouch '${sentinel}'\ncat\n`, {
      mode: 0o755,
    });
    await f.git("checkout", "main");
    await writeFile(path.join(f.root, ".gitattributes"), "file filter=late\n");
    await writeFile(
      path.join(f.root, ".filterconfig"),
      `[filter "late"]\nclean = ${script}\nsmudge = ${script}\n`,
    );
    await f.git("add", ".gitattributes", ".filterconfig");
    await f.git("commit", "-m", "included config");
    const head = await f.git("rev-parse", "HEAD");
    await f.git("update-ref", "refs/heads/codex/striker-test", head);
    await f.git("update-ref", "refs/striker/exports/test", head);
    await f.git("checkout", "original");
    await f.git("config", "include.path", "../.filterconfig");
    await new ApplyResult(f.root).apply({ ...f.intent, head }, undefined, () =>
      Promise.resolve(),
    );
    await expect(fs.access(sentinel)).rejects.toThrow();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
