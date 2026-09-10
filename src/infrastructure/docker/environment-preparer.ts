import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../config/project-config.js";
import type { EnvironmentPreparer } from "../../core/environment-preparation.js";
import { LocalExecutionConfig } from "../../permissions/local-execution-config.js";
import { prepareImage } from "./prepare-image.js";
import type { DockerCommand } from "./docker-command.js";

export function createEnvironmentPreparer(options: {
  projectRoot: string;
  stateRoot: string;
  docker?: DockerCommand;
}): EnvironmentPreparer {
  return {
    prepare: async (approveImage) => {
      const project = await loadProjectConfig(options.projectRoot);
      const config = new LocalExecutionConfig(
        path.join(options.stateRoot, "execution.json"),
      );
      const policy = await config.read();
      const image = await prepareImage({
        ...(options.docker === undefined ? {} : { docker: options.docker }),
        ...(project.image === undefined ? {} : { image: project.image }),
        approve: (id) => {
          if (!approveImage && !policy.approvedImages.includes(id))
            throw new Error(
              `Custom image ${id} requires local approval; rerun environment prepare --approve-image`,
            );
          return Promise.resolve();
        },
      });
      if (
        project.image !== undefined &&
        !policy.approvedImages.includes(image.imageId)
      ) {
        await config.write({
          ...policy,
          approvedImages: [...policy.approvedImages, image.imageId],
        });
      }
      await mkdir(options.stateRoot, { mode: 0o700, recursive: true });
      const destination = path.join(options.stateRoot, "prepared-image.json");
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(image, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return image;
    },
  };
}
