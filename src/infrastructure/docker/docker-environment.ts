import { lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FeatureEnvironmentAllocation,
  FeatureEnvironmentProvisioner,
  RetainedFeatureEnvironment,
} from "../../core/environment-preparation.js";
import { resourceLimitsSchema } from "../../permissions/local-execution-config.js";
import { allocateArtifactPaths } from "./artifact-paths.js";
import { containerRestrictions } from "./container-options.js";
import {
  dockerCommand,
  requireDocker,
  type DockerCommand,
} from "./docker-command.js";
import { validatePreparedImage } from "./prepare-image.js";

export class DockerEnvironment implements FeatureEnvironmentProvisioner {
  constructor(private readonly docker: DockerCommand = dockerCommand) {}

  async allocate(
    request: FeatureEnvironmentAllocation,
  ): Promise<RetainedFeatureEnvironment> {
    const resources = resourceLimitsSchema.parse(request.resources);
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    if (uid === 0 || gid === 0)
      throw new Error("Docker preparation must run as a non-root host user");
    const paths = await allocateArtifactPaths(request.stateRoot, request.runId);
    await requireDocker(this.docker);
    await validatePreparedImage(this.docker, request.image);
    const mounts: readonly (readonly [string, string])[] = [
      [paths.checkout, "/workspace"],
      [paths.state, "/state"],
      [paths.output, "/output"],
    ];
    const gatewayMount = await gatewayOptions(request);
    const environmentId = await this.docker([
      "create",
      "--name",
      `striker-${request.runId}`,
      "--label",
      `org.striker.run=${request.runId}`,
      ...containerRestrictions(resources, `${String(uid)}:${String(gid)}`),
      ...mounts.flatMap(([source, target]) => [
        "--mount",
        `type=bind,source=${source},target=${target}`,
      ]),
      ...gatewayMount,
      "--workdir",
      "/workspace",
      "--env",
      "HOME=/state",
      "--entrypoint",
      "/bin/sleep",
      request.image.imageId,
      "infinity",
    ]);
    if (!/^[a-f0-9]{64}$/.test(environmentId))
      throw new Error(
        "Docker returned an invalid container ID; inspect owned resources before retrying",
      );
    const result = {
      environmentId,
      imageId: request.image.imageId,
      checkout: paths.checkout,
      state: paths.state,
      output: paths.output,
    };
    await writeFile(
      path.join(paths.root, "environment.json"),
      `${JSON.stringify({ ...result, runId: request.runId, baselineId: request.image.baselineId, resources, gateway: request.gateway && { socketPath: request.gateway.socketPath, selection: request.gateway.selection } }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    return result;
  }
}

async function gatewayOptions(
  request: FeatureEnvironmentAllocation,
): Promise<string[]> {
  if (!request.gateway) return [];
  const socket = request.gateway.socketPath;
  if (
    !(await lstat(socket)).isSocket() ||
    (await realpath(socket)) !== socket ||
    socket.includes(",")
  )
    throw new Error("Gateway must be a real socket at a canonical path");
  return [
    "--mount",
    `type=bind,source=${socket},target=/gateway.sock,readonly`,
  ];
}
