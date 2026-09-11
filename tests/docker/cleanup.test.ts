import {
  mkdir,
  readFile,
  rm,
  symlink,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { featureFixture } from "./feature-fixture.js";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { DockerFeatureResources } from "../../src/infrastructure/docker/feature-resources.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { saveRecoveryRecord } from "../../src/infrastructure/docker/recovery-record.js";
import { FileRunJournal } from "../../src/infrastructure/file-run-journal.js";
import { CleanupFeature } from "../../src/core/cleanup-feature.js";
import { RunOperations } from "../../src/core/run-operations.js";
import {
  exportSourceCheckout,
  initializeCheckout,
} from "../../src/infrastructure/docker/independent-checkout.js";
import { dockerResultExporter } from "../../src/infrastructure/docker/result-exporter.js";

async function fixture() {
  const f = await featureFixture();
  const image = await prepareImage();
  const runId = path.basename(f.root);
  const environment = await new DockerEnvironment().allocate({
    stateRoot: f.root,
    runId,
    image,
    resources: { cpus: 1, memoryMiB: 1024, pids: 128 },
  });
  const source = await exportSourceCheckout(f.source, environment.inputs);
  await dockerCommand(["start", environment.environmentId]);
  await initializeCheckout(environment);
  const gateway = path.join(f.root, "gateway-owned");
  await mkdir(gateway);
  await writeFile(path.join(gateway, "selection.json"), "revocable");
  const recoveryId = await saveRecoveryRecord({
    version: 1,
    plan: { identity: "plan", manifest: "{}" },
    runId,
    projectRoot: f.source,
    harness: "codex",
    skills: [],
    contextId: "context",
    inputsId: "unused",
    containerId: "unused",
    environment,
    policy: {
      approvedImages: [],
      resources: { cpus: 1, memoryMiB: 1024, pids: 128 },
    },
    selection: { model: "gpt-5.6-sol", effort: "low" },
    socketPath: path.join(gateway, "access.sock"),
    source,
  });
  const journal = new FileRunJournal(f.root);
  const request = {
    runId,
    planId: "plan",
    completedTasks: [],
    skills: [],
    taskSource: { type: "memory", location: "plan" },
    execution: {
      backend: "docker" as const,
      recoveryId,
      environmentId: environment.environmentId,
      imageId: image.imageId,
      sourceRoot: f.source,
      sourceHead: source.head,
      sourceBranch: source.branch,
    },
  };
  await journal.append({ type: "run_started", runId, planId: "plan", request });
  const resources = new DockerFeatureResources(f.root, f.source);
  return {
    ...f,
    environment,
    journal,
    runId,
    image,
    sourceState: source,
    gateway,
    resources,
    cleanup: new CleanupFeature(journal, resources),
  };
}

test("discard stops workers and retains work; retryable cleanup preserves exported commits, journal and shared resources", async () => {
  const f = await fixture();
  const id = f.environment.environmentId;
  try {
    const { head, branch } = await exportCommit(f);
    await expect(f.cleanup.cleanup(f.runId)).rejects.toThrow(/running/);
    await f.journal.append({
      type: "run_source_changed",
      runId: f.runId,
      task: { id: "missing", revision: "old" },
      current: null,
    });
    await dockerCommand(["start", id]);
    await dockerCommand([
      "exec",
      "--detach",
      id,
      "sh",
      "-c",
      "while :; do echo changed >> /output/writer; sleep 0.1; done",
    ]);
    await new RunOperations(f.journal, f.resources).discard();
    expect(
      await dockerCommand(["inspect", "--format", "{{.State.Running}}", id]),
    ).toBe("false");
    expect(
      await readFile(path.join(f.environment.checkout, "result"), "utf8"),
    ).toBe("certified");
    await expect(
      readFile(path.join(f.gateway, "selection.json")),
    ).rejects.toThrow(/ENOENT/);
    const audit = await readFile(
      path.join(path.dirname(f.environment.inputs), "recovery.json"),
    );
    await mkdir(path.join(f.root, "broker"));
    await writeFile(path.join(f.root, "broker/login"), "host-login");
    const failing = new DockerFeatureResources(
      f.root,
      f.source,
      async (args) => {
        const result = await dockerCommand(args);
        if (args[0] === "rm") throw new Error("lost removal acknowledgement");
        return result;
      },
    );
    await expect(
      new CleanupFeature(f.journal, failing).cleanup(f.runId),
    ).rejects.toThrow(/acknowledgement/);
    expect((await f.journal.loadRun(f.runId))?.cleanup).toBe("started");
    await f.cleanup.cleanup(f.runId);
    await f.cleanup.cleanup(f.runId);
    for (const key of ["checkout", "state", "inputs", "output"] as const)
      await expect(readFile(f.environment[key])).rejects.toThrow(/ENOENT/);
    expect((await f.journal.loadRun(f.runId))?.cleanup).toBe("completed");
    expect(
      await readFile(
        path.join(path.dirname(f.environment.inputs), "recovery.json"),
      ),
    ).toEqual(audit);
    expect(await readFile(path.join(f.root, "broker/login"), "utf8")).toBe(
      "host-login",
    );
    expect((await f.git("rev-parse", branch)).stdout.trim()).toBe(head);
    expect(
      (
        await f.git("rev-parse", `refs/striker/exports/${f.runId}`)
      ).stdout.trim(),
    ).toBe(head);
    expect((await f.git("status", "--porcelain")).stdout).toBe("");
    await dockerCommand(["image", "inspect", f.image.imageId]);
  } finally {
    await dockerCommand(["rm", "--force", id]).catch(() => undefined);
    await rm(f.root, { recursive: true, force: true });
  }
}, 300_000);

test("cleanup refuses container ownership and artifact symlink substitution and retries partial workspace deletion", async () => {
  const f = await fixture();
  const id = f.environment.environmentId;
  try {
    await f.journal.append({ type: "run_completed", runId: f.runId });
    await expect(f.cleanup.cleanup(f.runId)).rejects.toThrow(/running/);
    await dockerCommand(["stop", "--time", "0", id]);
    const outside = path.join(f.root, "other-run");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "safe");
    const saved = `${f.environment.state}-saved`;
    await rename(f.environment.state, saved);
    await symlink(outside, f.environment.state);
    await expect(f.cleanup.cleanup(f.runId)).rejects.toThrow(/symlink|changed/);
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("safe");
    await rm(f.environment.state);
    await rename(saved, f.environment.state);
    const foreign = new DockerFeatureResources(
      f.root,
      f.source,
      async (args) => {
        if (args[0] !== "inspect") return dockerCommand(args);
        const data = JSON.parse(await dockerCommand(args)) as {
          Config: { Labels: Record<string, string> };
        }[];
        const container = data[0];
        if (!container) throw new Error("Missing test container");
        container.Config.Labels["org.striker.run"] = "other-run";
        return JSON.stringify(data);
      },
    );
    await expect(
      new CleanupFeature(f.journal, foreign).cleanup(f.runId),
    ).rejects.toThrow(/ownership/);
    await dockerCommand(["rm", id]);
    await rm(f.environment.checkout, { recursive: true });
    await symlink(outside, path.join(f.environment.state, "escape"));
    await f.cleanup.cleanup(f.runId);
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("safe");
  } finally {
    await dockerCommand(["rm", "--force", id]).catch(() => undefined);
    await rm(f.root, { recursive: true, force: true });
  }
}, 300_000);

async function exportCommit(f: Awaited<ReturnType<typeof fixture>>) {
  const id = f.environment.environmentId;
  await dockerCommand([
    "exec",
    id,
    "sh",
    "-c",
    "printf certified > result; git add result; git commit -m certified",
  ]);
  const head = await dockerCommand(["exec", id, "git", "rev-parse", "HEAD"]);
  const branch = `codex/striker-${f.runId}`;
  await dockerResultExporter(f.environment, f.source).export({
    runId: f.runId,
    branch,
    previousHead: null,
    startCommit: f.sourceState.head,
    resultCommit: head,
  });
  return { head, branch };
}
