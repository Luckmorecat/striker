import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { prepareWorkerResources } from "../../src/infrastructure/docker/worker-resources.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { StageExecutor } from "../../src/infrastructure/docker/stage-executor.js";
import { dockerExecutionServices } from "../../src/infrastructure/docker/execution-services.js";

test("memory exhaustion reports actionable verification evidence and retains files for recovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-limits-"));
  let id: string | undefined;
  try {
    const environment = await new DockerEnvironment().allocate({
      stateRoot: root,
      runId: "limits",
      image: await prepareImage(),
      resources: { cpus: 1, memoryMiB: 192, pids: 64 },
    });
    id = environment.environmentId;
    await prepareWorkerResources(environment.inputs, {
      identity: "test",
      skills: [],
    });
    const services = dockerExecutionServices(
      new StageExecutor({
        environment,
        contextId: "test",
        harness: "pi",
        selection: { model: "gpt-5.6-sol", effort: "low" },
        token: "test",
      }),
      "/project",
      [],
    );
    const result = await services.verifier.verify({
      cwd: "/project",
      command: `printf retained > dependency; node -e 'const a=[]; for (;;) a.push(Buffer.alloc(16*1024*1024,1))'`,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/memory|resource/i);
    expect(
      await services.verifier.verify({
        cwd: "/project",
        command: "test $(cat dependency) = retained",
      }),
    ).toMatchObject({ exitCode: 0 });
    const config = JSON.parse(
      await dockerCommand(["inspect", "--format", "{{json .HostConfig}}", id]),
    ) as { Memory: number; PidsLimit: number };
    expect(config.Memory).toBe(192 * 1024 * 1024);
    expect(config.PidsLimit).toBe(64);
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await rm(root, { recursive: true, force: true });
  }
}, 600_000);
