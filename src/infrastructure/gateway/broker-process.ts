import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { BrokerDescriptor } from "./broker-storage.js";

export async function unusedLoopbackPort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  if (!address || typeof address === "string")
    throw new Error("Cannot allocate broker port");
  return address.port;
}

export async function startBrokerProcess(
  descriptor: BrokerDescriptor,
  config: string,
  url: string,
  key: string,
  managementKey: string,
) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../../dist/infrastructure/gateway/broker-supervisor.js",
          import.meta.url,
        ),
      ),
      descriptor.binary,
      config,
      path.join(descriptor.authDirectory, ".striker-broker-lock"),
    ],
    {
      cwd: path.dirname(config),
      env: { ...process.env, MANAGEMENT_PASSWORD: managementKey },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  const exited = once(child, "exit");
  // Observe spawn failure immediately, without allowing a rejected promise to escape.
  void exited.catch(() => undefined);
  const close = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  };
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Broker exited before readiness");
      try {
        const response = await fetch(`${url}/v1/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(500),
        });
        const catalog = (await response.json()) as { data?: unknown[] };
        if (
          response.ok &&
          Array.isArray(catalog.data) &&
          catalog.data.length > 0
        )
          return { close };
      } catch {
        /* The loopback listener may not be ready yet. */
      }
      await delay(100);
    }
    throw new Error("Broker did not become ready");
  } catch {
    await close();
    throw new Error(
      "Cannot start the prepared broker; check local port availability and subscription setup",
    );
  }
}
