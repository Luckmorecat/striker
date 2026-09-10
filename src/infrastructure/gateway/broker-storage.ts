import { brokerAuthFiles } from "./broker-auth-storage.js";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";

export const brokerVersion = "7.2.157";
const descriptorSchema = z
  .object({ binary: z.string(), digest: z.string(), authDirectory: z.string() })
  .strict();
export type BrokerDescriptor = z.infer<typeof descriptorSchema>;
const digest = async (binary: string) =>
  createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");

export async function prepareBroker(
  root: string,
  binary: string,
  authDirectory?: string,
): Promise<void> {
  const source = await realpath(binary);
  const version = await promisify(execFile)(source, ["-h"], {
    timeout: 10_000,
  });
  if (!version.stdout.includes(`CLIProxyAPI Version: ${brokerVersion},`))
    throw new Error(
      `Install CLIProxyAPI ${brokerVersion}; supplied broker version does not match`,
    );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const auth = path.resolve(authDirectory ?? path.join(root, "auth"));
  await mkdir(auth, { recursive: true, mode: 0o700 });
  await chmod(auth, 0o700);
  await brokerAuthFiles(auth);
  const target = path.join(root, "cli-proxy-api");
  const temporary = `${target}.${randomBytes(8).toString("hex")}`;
  await copyFile(source, temporary);
  await chmod(temporary, 0o700);
  await rename(temporary, target);
  const descriptor = {
    binary: target,
    digest: await digest(target),
    authDirectory: await realpath(auth),
  };
  await writeFile(path.join(root, "broker.json"), JSON.stringify(descriptor), {
    mode: 0o600,
  });
}

export async function readBroker(root: string): Promise<BrokerDescriptor> {
  try {
    const descriptor = descriptorSchema.parse(
      JSON.parse(await readFile(path.join(root, "broker.json"), "utf8")),
    );
    if ((await digest(descriptor.binary)) !== descriptor.digest)
      throw new Error("Broker executable changed");
    return descriptor;
  } catch {
    throw new Error(
      `Broker preparation is missing or changed. Run striker auth prepare --broker <CLIProxyAPI-${brokerVersion}-path>`,
    );
  }
}

export function brokerConfiguration(
  authDirectory: string,
  port: number,
  key: string,
) {
  return {
    host: "127.0.0.1",
    port,
    "auth-dir": authDirectory,
    "api-keys": [key],
    "remote-management": {
      "allow-remote": false,
      "secret-key": "",
      "disable-control-panel": true,
      "disable-auto-update-panel": true,
    },
    debug: false,
    "logging-to-file": false,
    "request-log": false,
    "request-retry": 0,
    "quota-exceeded": {
      "switch-project": false,
      "switch-preview-model": false,
    },
  };
}
