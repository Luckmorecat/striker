import { resourceLimitsSchema } from "../../permissions/local-execution-config.js";
import type { PreparedEnvironmentImage } from "../../core/environment-preparation.js";
import { z } from "zod";
import { loadBaseline } from "./baseline.js";
import { containerRestrictions } from "./container-options.js";
import {
  dockerCommand,
  requireDocker,
  type DockerCommand,
} from "./docker-command.js";

const imageSchema = z
  .array(
    z.object({
      Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      Os: z.literal("linux"),
      Config: z.object({
        Labels: z.record(z.string(), z.string()).nullish(),
        Volumes: z.record(z.string(), z.unknown()).nullish(),
      }),
    }),
  )
  .length(1);

export interface PrepareImageOptions {
  readonly docker?: DockerCommand;
  readonly image?: string;
  readonly approve?: (imageId: string) => Promise<void>;
}

async function inspect(docker: DockerCommand, image: string) {
  const result = imageSchema.parse(
    JSON.parse(await docker(["image", "inspect", image])),
  )[0];
  if (!result) throw new Error("Docker returned no image");
  return result;
}

async function resolveImage(
  docker: DockerCommand,
  baseline: Awaited<ReturnType<typeof loadBaseline>>,
  custom?: string,
) {
  if (custom !== undefined) {
    if (!custom || custom.startsWith("-"))
      throw new Error("Invalid local image name");
    try {
      return await inspect(docker, custom);
    } catch (cause) {
      throw new Error(
        `Cannot inspect local image ${custom}. Build/load it locally first; Striker will not pull it. ${String(cause)}`,
        { cause },
      );
    }
  }
  try {
    return await inspect(docker, baseline.tag);
  } catch (cause) {
    if (!/No such image|not found/i.test(String(cause))) throw cause;
  }
  try {
    await docker([
      "build",
      "--tag",
      baseline.tag,
      "--build-arg",
      `BASE_IMAGE=${baseline.manifest.baseImage}`,
      "--build-arg",
      `BASELINE_ID=${baseline.identity}`,
      baseline.root,
    ]);
  } catch (cause) {
    throw new Error(
      `Bundled image build failed. Check Docker build/network/toolchain output: ${String(cause)}`,
      { cause },
    );
  }
  return inspect(docker, baseline.tag);
}

export async function prepareImage(
  options: PrepareImageOptions = {},
): Promise<PreparedEnvironmentImage> {
  const docker = options.docker ?? dockerCommand;
  await requireDocker(docker);
  const baseline = await loadBaseline();
  const image = await resolveImage(docker, baseline, options.image);
  if (image.Config.Labels?.["org.striker.baseline"] !== baseline.identity)
    throw new Error(
      "Image must derive from the current prepared Striker baseline",
    );
  if (Object.keys(image.Config.Volumes ?? {}).length)
    throw new Error(
      "Image-declared volumes are not permitted; use Striker's explicit mounts",
    );
  if (options.image !== undefined) {
    if (!options.approve)
      throw new Error(
        "Custom image requires local approval of its immutable image ID",
      );
    await options.approve(image.Id);
  }
  try {
    await docker([
      "run",
      "--rm",
      ...containerRestrictions(resourceLimitsSchema.parse({}), "1000:1000"),
      "--entrypoint",
      "/usr/local/bin/node",
      image.Id,
      "/opt/striker/probe.mjs",
      JSON.stringify(baseline.manifest),
    ]);
  } catch (cause) {
    throw new Error(`Image toolchain validation failed: ${String(cause)}`, {
      cause,
    });
  }
  return { imageId: image.Id, baselineId: baseline.identity };
}

export async function validatePreparedImage(
  docker: DockerCommand,
  prepared: PreparedEnvironmentImage,
): Promise<void> {
  if (!/^sha256:[a-f0-9]{64}$/.test(prepared.imageId))
    throw new Error("An immutable local image ID is required");
  const image = await inspect(docker, prepared.imageId);
  if (
    image.Id !== prepared.imageId ||
    image.Config.Labels?.["org.striker.baseline"] !== prepared.baselineId
  )
    throw new Error("Prepared image identity changed");
  if (Object.keys(image.Config.Volumes ?? {}).length)
    throw new Error(
      "Image-declared volumes are not permitted; use Striker's explicit mounts",
    );
}
