import { StageExecutor } from "../../src/infrastructure/docker/stage-executor.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { prepareWorkerResources } from "../../src/infrastructure/docker/worker-resources.js";
import {
  exportSourceCheckout,
  initializeCheckout,
} from "../../src/infrastructure/docker/independent-checkout.js";
import { callWorker } from "../../src/infrastructure/docker/worker-client.js";

test("worker Git and verification use an independent retained checkout and preserve the source", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "striker-source-"));
  const stateRoot = await mkdtemp(path.join(tmpdir(), "striker-worker-"));
  let id: string | undefined;
  try {
    const git = (...args: string[]) =>
      promisify(execFile)("git", ["-C", source, ...args]);
    await git("init");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@localhost");
    await writeFile(path.join(source, "source"), "untouched");
    await git("add", ".");
    await git("commit", "-m", "baseline");
    const environment = await new DockerEnvironment().allocate({
      runId: "worker-test",
      stateRoot,
      image: await prepareImage(),
      resources: { cpus: 1, memoryMiB: 1024, pids: 64 },
    });
    id = environment.environmentId;
    await exportSourceCheckout(source, environment.inputs);
    await prepareWorkerResources(environment.inputs, {
      identity: "test",
      skills: [],
    });
    await dockerCommand(["start", id]);
    await initializeCheckout(environment);
    const command = [
      "node",
      "/opt/striker/run/worker/dist/runner/worker/main.js",
    ];
    const result = await callWorker({
      environmentId: id,
      command,
      request: {
        operation: "verify",
        command:
          "test ! -e .git/objects/info/alternates && test -d .git && printf retained > dependency && printf first > result && git add result && git commit -m first",
      },
    });
    expect(result).toMatchObject({ exitCode: 0 });
    await dockerCommand(["stop", "--time", "0", id]);
    await dockerCommand(["start", id]);
    expect(
      await callWorker({
        environmentId: id,
        command,
        request: {
          operation: "verify",
          command:
            "test $(cat dependency) = retained && printf second >> result && git add result && git commit -m second",
        },
      }),
    ).toMatchObject({ exitCode: 0 });
    await assertQuiescence(environment);
    expect((await git("status", "--porcelain")).stdout).toBe("");
    expect(await readFile(path.join(source, "source"), "utf8")).toBe(
      "untouched",
    );
    expect(
      (await git("log", "--oneline")).stdout.trim().split("\n"),
    ).toHaveLength(1);
  } finally {
    try {
      if (id) await dockerCommand(["rm", "--force", id]);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(stateRoot, { recursive: true, force: true });
    }
  }
}, 600_000);

async function assertQuiescence(
  environment: Parameters<typeof initializeCheckout>[0],
) {
  const executor = new StageExecutor({
    environment,
    contextId: "test",
    harness: "pi",
    selection: { model: "gpt-5.6-sol", effort: "low" },
    token: "fake-run-key",
  });
  expect(
    await executor.execute({
      operation: "verify",
      command: "(sleep 1; printf escaped > delayed) >/dev/null 2>&1 &",
    }),
  ).toMatchObject({ exitCode: 0 });
  expect(
    await executor.execute({
      operation: "verify",
      command: "sleep 2; test ! -e delayed",
    }),
  ).toMatchObject({ exitCode: 0 });
}
