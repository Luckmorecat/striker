import path from "node:path";
import {
  recoveryFixture,
  fakeBroker,
  hostCommand,
  activeFixture,
} from "./recovery-fixture.js";
import { fakeResponses } from "./fake-responses.js";
import { recoverDockerRun } from "../../src/cli/docker-recovery.js";
import { rm, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { featureFixture } from "./feature-fixture.js";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import {
  exportSourceCheckout,
  initializeCheckout,
} from "../../src/infrastructure/docker/independent-checkout.js";
import { dockerResultExporter } from "../../src/infrastructure/docker/result-exporter.js";

test("exports exact retained-container commits with crash retry and preserves the host checkout", async () => {
  const f = await featureFixture();
  let id: string | undefined;
  try {
    const environment = await new DockerEnvironment().allocate({
      stateRoot: f.root,
      runId: "export",
      image: await prepareImage(),
      resources: { cpus: 2, memoryMiB: 2048, pids: 128 },
    });
    id = environment.environmentId;
    const source = await exportSourceCheckout(f.source, environment.inputs);
    await dockerCommand(["start", id]);
    await initializeCheckout(environment);
    const commit = async (word: string) => {
      await dockerCommand(["start", environment.environmentId]);
      await dockerCommand([
        "exec",
        environment.environmentId,
        "sh",
        "-c",
        'printf %s "$1" > file; git add file; git commit -m "$1"',
        "striker-test",
        word,
      ]);
      return dockerCommand([
        "exec",
        environment.environmentId,
        "git",
        "rev-parse",
        "HEAD",
      ]);
    };
    const one = await commit("one");
    const two = await commit("two");
    const exporter = dockerResultExporter(environment, f.source);
    const intent = {
      runId: "export",
      branch: "codex/striker-export",
      startCommit: source.head,
      resultCommit: one,
      previousHead: null,
    };
    await exporter.export(intent);
    expect((await f.git("rev-parse", intent.branch)).stdout.trim()).toBe(one);
    await exporter.export(intent); // recovery after ref update, before host journal append
    await exporter.export({
      ...intent,
      startCommit: one,
      resultCommit: two,
      previousHead: one,
    });
    expect(
      (
        await f.git("log", "--format=%s", `${source.head}..${intent.branch}`)
      ).stdout.trim(),
    ).toBe("two\none");
    const three = await commit("three");
    await f.git("update-ref", `refs/heads/${intent.branch}`, one);
    await expect(
      exporter.export({
        ...intent,
        startCommit: two,
        resultCommit: three,
        previousHead: two,
      }),
    ).rejects.toThrow(/divergence/);
    expect((await f.git("rev-parse", "HEAD")).stdout.trim()).toBe(source.head);
    expect((await f.git("status", "--porcelain")).stdout).toBe("");
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await rm(f.root, { recursive: true, force: true });
  }
}, 300_000);

test("recovers host export intent before the next task and retains the prefix when that task fails", async () => {
  const f = await recoveryFixture("codex");
  const fake = await fakeResponses();
  let id: string | undefined;
  try {
    await fakeBroker(f, fake.url);
    expect((await hostCommand(f, "run", "task_completed")).event?.type).toBe(
      "task_completed",
    );
    const active = await activeFixture(f);
    id = active.id;
    const state = active.snapshot.resultExport;
    if (!state?.pending) throw new Error("Missing certified export intent");
    expect(state.head).toBeNull();
    expect(
      (await hostCommand(f, "resume", "result_export_completed")).event?.type,
    ).toBe("result_export_completed");
    const exported = await exportedBranch(active.journal);
    expect(exported.head).toBe(state.pending.resultCommit);
    expect((await f.git("rev-parse", exported.branch)).stdout.trim()).toBe(
      exported.head,
    );
    const second = path.join(f.plan, "tasks/02.md");
    await writeFile(
      second,
      (await readFile(second, "utf8")).replace(
        'test "$(cat second.txt)" = second',
        "exit 1",
      ),
    );
    const result = await recoverDockerRun({ ...f.run, action: "resume" });
    expect(result).toMatchObject({
      status: "needs_attention",
      reason: "verification_failed",
      resultExport: { head: exported.head },
    });
    const recovered = await active.journal.loadActive();
    expect(recovered?.completedTasks).toHaveLength(1);
    expect((await f.git("rev-parse", exported.branch)).stdout.trim()).toBe(
      exported.head,
    );
    expect((await f.git("rev-parse", "HEAD")).stdout.trim()).toBe(
      active.descriptor.sourceHead,
    );
    expect((await f.git("status", "--porcelain")).stdout).toBe("");
    expect(fake.errors).toEqual([]);
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await fake.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 600_000);

async function exportedBranch(
  journal: import("../../src/core/contracts.js").RunJournal,
) {
  const state = (await journal.loadActive())?.snapshot?.resultExport;
  if (!state?.head) throw new Error("Missing exported branch");
  return { branch: state.branch, head: state.head };
}
