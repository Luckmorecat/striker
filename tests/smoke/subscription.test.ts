import { mkdtemp, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CredentialBroker } from "../../src/infrastructure/gateway/credential-broker.js";
import { openRunConnectivity } from "../../src/infrastructure/gateway/run-connectivity.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { prepareHarnessLaunch } from "../../src/runner/worker/harness-launch.js";
import { parseProjectConfig } from "../../src/config/project-config.js";
import { LocalExecutionConfig } from "../../src/permissions/local-execution-config.js";

test("real subscription refresh, tools, streaming, context, cancellation, search and public egress", async () => {
  const harness = process.env.STRIKER_SMOKE_HARNESS;
  const brokerRoot = process.env.STRIKER_SMOKE_BROKER_ROOT;
  if (!brokerRoot || (harness !== "codex" && harness !== "pi"))
    throw new Error(
      "Explicit --harness codex|pi and STRIKER_SMOKE_BROKER_ROOT with prepared subscription login are required",
    );
  const root = await mkdtemp(path.join(tmpdir(), "striker-smoke-"));
  const broker = await new CredentialBroker(brokerRoot).open();
  let environmentId: string | undefined;
  let connectivity: Awaited<ReturnType<typeof openRunConnectivity>> | undefined;
  try {
    await broker.refresh();
    const config = parseProjectConfig({ taskSource: "striker-plan", harness });
    const policy = await new LocalExecutionConfig(
      path.join(root, "execution.json"),
    ).read();
    connectivity = await openRunConnectivity({
      root,
      broker,
      config,
      services: policy.services ?? [],
    });
    const image = await prepareImage();
    const environment = await new DockerEnvironment().allocate({
      runId: `smoke-${harness}`,
      stateRoot: root,
      image,
      resources: policy.resources,
      gateway: connectivity,
    });
    environmentId = environment.environmentId;
    const launch = await prepareHarnessLaunch(environment.state, {
      harness,
      ...connectivity.selection,
      token: connectivity.token,
    });
    await copyFile(
      fileURLToPath(new URL("./subscription-client.mjs", import.meta.url)),
      path.join(environment.state, "smoke.mjs"),
    );
    const descriptor = JSON.parse(
      await readFile(
        path.join(root, `environments/smoke-${harness}/environment.json`),
        "utf8",
      ),
    ) as { gateway: { selection: unknown } };
    expect(descriptor.gateway.selection).toEqual(connectivity.selection);
    await dockerCommand(["start", environmentId]);
    const output = await dockerCommand([
      "exec",
      environmentId,
      ...launch.command,
      "node",
      "/state/smoke.mjs",
    ]);
    expect(output).toContain(`subscription-${harness}-ok`);
    expect(output).toContain("stream-cancellation-ok");
    console.info(
      `${harness}: refresh, HTTP/HTTPS, terminal, streaming, source search, retained context, cancellation passed; image ${image.imageId}`,
    );
  } finally {
    try {
      await connectivity?.close();
    } finally {
      await releaseResources(environmentId, broker, root);
    }
  }
}, 600_000);

async function releaseResources(
  environmentId: string | undefined,
  broker: { close(): Promise<void> },
  root: string,
) {
  try {
    if (environmentId) await dockerCommand(["rm", "--force", environmentId]);
  } finally {
    try {
      await broker.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
