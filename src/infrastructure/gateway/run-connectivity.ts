import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  resolveModelSelection,
  type ProjectConfig,
} from "../../config/project-config.js";
import { NetworkPolicy, type NamedServiceGrant } from "./network-policy.js";
import { RunGateway } from "./run-gateway.js";

interface ConnectivityRequest {
  readonly root: string;
  readonly socketPath?: string;
  readonly config: ProjectConfig;
  readonly services: readonly NamedServiceGrant[];
  readonly broker: {
    readonly url: string;
    readonly key: string;
    models(): Promise<readonly string[]>;
  };
}

/** The caller owns the broker lease; closing this run revokes only its gateway. */
export async function openRunConnectivity(request: ConnectivityRequest) {
  const selection = resolveModelSelection(request.config);
  if (!(await request.broker.models()).includes(selection.model))
    throw new Error(
      `Selected subscription model is unavailable: ${selection.model}`,
    );
  await mkdir(request.root, { recursive: true, mode: 0o700 });
  const directory = request.socketPath
    ? path.dirname(request.socketPath)
    : await mkdtemp(path.join(await realpath(request.root), "gateway-"));
  if (request.socketPath) {
    await mkdir(directory, { mode: 0o700 });
  }
  const socketPath = path.join(directory, "access.sock");
  const descriptorPath = path.join(directory, "selection.json");
  const gateway = new RunGateway({
    ...selection,
    brokerUrl: `${request.broker.url}/v1/responses`,
    brokerKey: request.broker.key,
    networkPolicy: new NetworkPolicy(request.services),
  });
  try {
    const { token } = await gateway.listen(socketPath);
    await chmod(socketPath, 0o600);
    await writeFile(
      descriptorPath,
      JSON.stringify({ selection, services: request.services }),
      { mode: 0o600, flag: "wx" },
    );
    return {
      socketPath,
      descriptorPath,
      selection,
      token,
      close: async () => {
        await gateway.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
