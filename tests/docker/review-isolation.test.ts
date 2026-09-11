import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { containerRestrictions } from "../../src/infrastructure/docker/container-options.js";

test("review processes cannot read the main checkout or mutate the snapshot, including through child processes and proc aliases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-review-"));
  try {
    for (const name of ["workspace", "review", "scratch"])
      await mkdir(path.join(root, name));
    await writeFile(path.join(root, "workspace/secret"), "protected-main");
    await writeFile(path.join(root, "review/candidate"), "protected-candidate");
    const image = await prepareImage();
    const output = await dockerCommand([
      "run",
      "--rm",
      ...containerRestrictions(
        { cpus: 1, memoryMiB: 1024, pids: 64 },
        `${String(process.getuid?.())}:${String(process.getgid?.())}`,
      ),
      ...["workspace", "review", "scratch"].flatMap((name) => [
        "--mount",
        `type=bind,source=${path.join(root, name)},target=/${name}${name === "review" ? ",readonly" : ""}`,
      ]),
      "--mount",
      `type=bind,source=${fileURLToPath(new URL("./review-isolation-client.mjs", import.meta.url))},target=/opt/probe.mjs,readonly`,
      "--entrypoint",
      "/opt/striker/restrict-stage",
      image.imageId,
      "/review",
      "/scratch",
      "--",
      "node",
      "/opt/probe.mjs",
    ]);
    expect(output).toBe("review-isolation-ok");
    expect(await readFile(path.join(root, "workspace/secret"), "utf8")).toBe(
      "protected-main",
    );
    expect(await readFile(path.join(root, "review/candidate"), "utf8")).toBe(
      "protected-candidate",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 600_000);
