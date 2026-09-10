import { once } from "node:events";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { RunGateway } from "../../src/infrastructure/gateway/run-gateway.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { containerRestrictions } from "../../src/infrastructure/docker/container-options.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";

test("execution receives only a run key and cannot route to broker management or leak upstream errors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-credentials-"));
  let authorization: string | undefined;
  const target = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(401).end("sensitive-upstream-error broker-host-secret");
  }).listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    brokerKey: "broker-host-secret",
    model: "selected",
    effort: "low",
  });
  try {
    const socket = path.join(root, "gateway.sock");
    const access = await gateway.listen(socket);
    await chmod(socket, 0o600);
    const image = await prepareImage();
    const output = await dockerCommand([
      "run",
      "--rm",
      ...containerRestrictions(
        { cpus: 1, memoryMiB: 1024, pids: 64 },
        `${String(process.getuid?.())}:${String(process.getgid?.())}`,
      ),
      "--mount",
      `type=bind,source=${socket},target=/gateway.sock,readonly`,
      "--mount",
      `type=bind,source=${fileURLToPath(new URL("./credentials-client.mjs", import.meta.url))},target=/probe.mjs,readonly`,
      "--env",
      `RUN_KEY=${access.token}`,
      "--entrypoint",
      "node",
      image.imageId,
      "/probe.mjs",
    ]);
    expect(output).toBe("gateway-credentials-boundary-ok");
    expect(authorization).toBe("Bearer broker-host-secret");
  } finally {
    await gateway.close();
    target.closeAllConnections();
    await new Promise<void>((resolve) => {
      target.close(() => {
        resolve();
      });
    });
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
