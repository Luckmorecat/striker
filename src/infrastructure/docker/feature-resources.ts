import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RunSnapshot } from "../../core/contracts.js";
import type {
  ExecutionStopper,
  FeatureResources,
} from "../../core/cleanup-feature.js";
import { assertCleanupEligible } from "../../core/cleanup-feature.js";
import { dockerCommand, type DockerCommand } from "./docker-command.js";
import { readOwnedRecoveryRecord } from "./recovery-record.js";

const artifactNames = ["checkout", "state", "output", "inputs"] as const;
const containerSchema = z.array(
  z.object({
    Id: z.string(),
    Image: z.string(),
    State: z.object({ Running: z.boolean() }),
    Config: z.object({ Labels: z.record(z.string(), z.string()) }),
    Mounts: z.array(
      z.object({
        Source: z.string(),
        Destination: z.string(),
        Type: z.string(),
      }),
    ),
  }),
);
type Owned = Awaited<ReturnType<typeof readOwnedRecoveryRecord>>;

/** Called under the project operation lease; never opens model connectivity. */
export class DockerFeatureResources
  implements FeatureResources, ExecutionStopper
{
  constructor(
    private readonly stateRoot: string,
    private readonly projectRoot: string,
    private readonly docker: DockerCommand = dockerCommand,
  ) {}

  async stop(snapshot: RunSnapshot): Promise<void> {
    const owned = await this.owned(snapshot);
    const container = await this.container(owned);
    if (container) await this.docker(["stop", "--time", "0", container.Id]);
    await this.revoke(owned);
  }

  async remove(snapshot: RunSnapshot): Promise<void> {
    assertCleanupEligible(snapshot);
    const owned = await this.owned(snapshot);
    const container = await this.container(owned);
    if (container?.State.Running)
      throw new Error(
        "Retained container is running; stop and discard execution before cleanup",
      );
    await validateArtifacts(owned.root);
    await this.revoke(owned);
    // No --force: a container started concurrently must cause refusal.
    if (container) await this.docker(["rm", container.Id]);
    for (const name of artifactNames) {
      await validateArtifacts(owned.root);
      await rm(path.join(owned.root, name), { recursive: true, force: true });
    }
  }

  private async owned(snapshot: RunSnapshot): Promise<Owned> {
    const descriptor = snapshot.request.execution;
    if (!descriptor) throw new Error("Missing isolated execution ownership");
    const owned = await readOwnedRecoveryRecord(
      this.stateRoot,
      snapshot.runId,
      descriptor,
    );
    const { record, root } = owned;
    if (
      record.projectRoot !== this.projectRoot ||
      descriptor.sourceRoot !== this.projectRoot
    )
      throw new Error("Execution source ownership does not match this project");
    for (const name of artifactNames)
      if (record.environment[name] !== path.join(root, name))
        throw new Error("Execution artifact ownership changed");
    return owned;
  }

  private async container({ record }: Owned) {
    const id = record.environment.environmentId;
    const data = await this.docker(["inspect", id]).catch(
      async (error: unknown) => {
        // A successful daemon query distinguishes absence from inaccessible Docker.
        const found = await this.docker([
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          `id=${id}`,
          "--format",
          "{{.ID}}",
        ]);
        if (found) throw error;
        return "[]";
      },
    );
    const container = containerSchema.parse(JSON.parse(data))[0];
    if (!container) return null;
    if (
      container.Id !== id ||
      container.Image !== record.environment.imageId ||
      container.Config.Labels["org.striker.run"] !== record.runId
    )
      throw new Error("Container ownership does not match the recorded run");
    const mounts = new Map([
      ["/workspace", record.environment.checkout],
      ["/state", record.environment.state],
      ["/output", record.environment.output],
      ["/opt/striker/run", record.environment.inputs],
      ["/gateway.sock", record.socketPath],
    ]);
    for (const mount of container.Mounts) {
      if (mount.Type === "tmpfs") continue;
      if (
        mount.Type !== "bind" ||
        mounts.get(mount.Destination) !== mount.Source
      )
        throw new Error("Container mount ownership changed");
    }
    return container;
  }

  private async revoke({ record }: Owned) {
    const root = await realpath(this.stateRoot);
    const directory = path.dirname(record.socketPath);
    if (
      path.dirname(directory) !== root ||
      !/^gateway-[a-zA-Z0-9_-]+$/.test(path.basename(directory)) ||
      path.basename(record.socketPath) !== "access.sock"
    )
      throw new Error("Gateway ownership is outside private run state");
    await canonicalDirectory(directory);
    await rm(directory, { recursive: true, force: true });
  }
}

async function canonicalDirectory(directory: string): Promise<void> {
  const info = await lstat(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (
    info &&
    (!info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(directory)) !== directory)
  )
    throw new Error("Execution artifact directory changed or is a symlink");
}
async function validateArtifacts(root: string) {
  await canonicalDirectory(root);
  for (const name of artifactNames)
    await canonicalDirectory(path.join(root, name));
}
