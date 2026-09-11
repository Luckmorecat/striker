import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { recoveryFixture, fakeBroker } from "./recovery-fixture.js";
import { fakeResponses } from "./fake-responses.js";
import { FileRunJournal } from "../../src/infrastructure/file-run-journal.js";
import { parseStrikerPlan } from "../../src/adapters/striker-plan/plan-parser.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";

for (const harness of ["codex", "pi"] as const) {
  test(`${harness}: default CLI execution exports, applies and cleans up a complete feature`, async () => {
    const original = await recoveryFixture(harness);
    const stateRoot = path.join(original.source, ".git/striker");
    await rename(original.stateRoot, stateRoot);
    const f = { ...original, stateRoot };
    const fake = await fakeResponses();
    let id: string | undefined;
    const cli = (...args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL("../../dist/cli.js", import.meta.url)), ...args],
        { cwd: f.source, maxBuffer: 4 * 1024 * 1024 },
      );
    try {
      await writeFile(
        path.join(f.source, "striker.config.json"),
        JSON.stringify({ taskSource: "striker-plan", harness }),
      );
      await f.git("add", ".");
      await f.git("commit", "-m", "configure");
      const head = (await f.git("rev-parse", "HEAD")).stdout;
      await fakeBroker(f, fake.url);
      const result = await cli("run", f.plan, "--no-interactive");
      const journal = new FileRunJournal(stateRoot);
      const snapshot = (
        await journal.load((await parseStrikerPlan(f.plan)).identity)
      )?.snapshot;
      id = snapshot?.request.execution?.environmentId;
      expect(snapshot?.status).toBe("completed");
      if (!snapshot?.resultExport?.head)
        throw new Error("Missing certified export");
      expect(result.stdout).toContain("Execution: docker");
      expect(result.stdout).toContain(`Run: ${snapshot.runId}`);
      expect(result.stdout).toContain("Model: gpt-5.6-sol (low)");
      expect(result.stdout).toContain(
        `Artifacts: ${stateRoot}/environments/${snapshot.runId}`,
      );
      expect((await f.git("rev-parse", "HEAD")).stdout).toBe(head);
      expect((await f.git("status", "--porcelain")).stdout).toBe("");
      await cli("cleanup", snapshot.runId, "--force");
      id = undefined;
      await cli("apply", snapshot.runId);
      expect((await f.git("rev-parse", "HEAD")).stdout.trim()).toBe(
        snapshot.resultExport.head,
      );
      expect(await readFile(path.join(f.source, "second.txt"), "utf8")).toBe(
        "second",
      );
      expect(
        (
          await f.git("rev-list", "--count", `${head.trim()}..HEAD`)
        ).stdout.trim(),
      ).toBe("2");
      expect(fake.errors).toEqual([]);
    } finally {
      if (id) await dockerCommand(["rm", "--force", id]);
      await fake.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }, 600_000);
}
