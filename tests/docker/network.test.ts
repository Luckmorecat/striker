import { once } from "node:events";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { RunGateway } from "../../src/infrastructure/gateway/run-gateway.js";
import { NetworkPolicy } from "../../src/infrastructure/gateway/network-policy.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { containerRestrictions } from "../../src/infrastructure/docker/container-options.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";

test("socket-only gateway enforces egress while retaining internal feature services", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-network-"));
  const target = createServer((_request, response) =>
    response.end("approved-service"),
  ).listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: "http://127.0.0.1:1/v1/responses",
    brokerKey: "host-only-secret",
    model: "selected",
    effort: "low",
    networkPolicy: new NetworkPolicy(
      [
        {
          name: "service.example",
          port: address.port,
          addresses: ["127.0.0.1"],
        },
      ],
      () => Promise.resolve(["127.0.0.1"]),
    ),
  });
  try {
    const socket = path.join(root, "gateway.sock");
    const access = await gateway.listen(socket);
    await chmod(socket, 0o600);
    const sentinel = path.join(root, "credentials");
    await writeFile(sentinel, "host-only-secret", { mode: 0o600 });
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
      `type=bind,source=${fileURLToPath(new URL("./gateway-client.mjs", import.meta.url))},target=/probe.mjs,readonly`,
      "--env",
      `RUN_KEY=${access.token}`,
      "--env",
      `SERVICE_URL=http://service.example:${String(address.port)}/`,
      "--env",
      `HOST_SENTINEL=${sentinel}`,
      "--entrypoint",
      "node",
      image.imageId,
      "/probe.mjs",
    ]);
    expect(output).toBe("gateway-network-boundary-ok");
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
