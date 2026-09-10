import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { dockerCommand as docker } from "../../src/infrastructure/docker/docker-command.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { loadBaseline } from "../../src/infrastructure/docker/baseline.js";

it("prepares cached and derived images, and retains only explicit private writable mounts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-docker-"));
  const tag = `striker-test:${randomUUID()}`;
  let container: string | undefined;
  try {
    const image = await prepareImage();
    expect(await prepareImage()).toEqual(image);
    await writeFile(
      path.join(root, "Dockerfile"),
      `FROM ${(await loadBaseline()).tag}\nUSER root\nRUN printf '#!/bin/sh\\necho derived-tool\\n' > /usr/local/bin/extra-tool && chmod 755 /usr/local/bin/extra-tool\nUSER 1000:1000\n`,
    );
    await docker(["build", "--tag", tag, root]);
    const derived = await prepareImage({
      image: tag,
      approve: () => Promise.resolve(),
    });
    expect(derived.imageId).not.toBe(image.imageId);
    const sentinel = path.join(root, "host-sentinel");
    await writeFile(sentinel, "host-only");
    const environment = await new DockerEnvironment().allocate({
      image: derived,
      runId: randomUUID(),
      stateRoot: path.join(root, "private"),
      resources: { cpus: 1, memoryMiB: 1024, pids: 64 },
    });
    container = environment.environmentId;
    await docker(["start", container]);
    await inspectRestrictions(environment);
    expect(await docker(["exec", container, "extra-tool"])).toBe(
      "derived-tool",
    );
    await expect(
      docker(["exec", container, "cat", sentinel]),
    ).rejects.toThrow();
    await expect(
      docker(["exec", container, "cat", "/var/run/docker.sock"]),
    ).rejects.toThrow();
    await expect(
      docker(["exec", container, "touch", "/etc/forbidden"]),
    ).rejects.toThrow();
    await docker([
      "exec",
      container,
      "sh",
      "-c",
      "echo retained > /workspace/dependency; echo state > /state/session; echo output > /output/result; touch /tmp/scratch",
    ]);
    await docker(["stop", "--time", "1", container]);
    await docker(["start", container]);
    expect(
      await docker(["exec", container, "cat", "/workspace/dependency"]),
    ).toBe("retained");
    expect(await readFile(sentinel, "utf8")).toBe("host-only");
    expect((await loadBaseline()).identity).toBe(derived.baselineId);
  } finally {
    if (container) await docker(["rm", "--force", container]);
    await docker(["image", "rm", tag]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}, 1_200_000);

async function inspectRestrictions(
  environment: import("../../src/core/environment-preparation.js").RetainedFeatureEnvironment,
) {
  const container = environment.environmentId;
  const inspected = JSON.parse(await docker(["inspect", container])) as {
    Config: { User: string };
    HostConfig: {
      Privileged: boolean;
      ReadonlyRootfs: boolean;
      NetworkMode: string;
      CapDrop: string[];
      SecurityOpt: string[];
      NanoCpus: number;
      Memory: number;
      PidsLimit: number;
    };
    Mounts: { Source: string; Destination: string; RW: boolean }[];
  }[];
  expect(inspected[0]?.Config.User).toBe(
    `${String(process.getuid?.())}:${String(process.getgid?.())}`,
  );
  expect(inspected[0]?.HostConfig).toMatchObject({
    Privileged: false,
    ReadonlyRootfs: true,
    NetworkMode: "none",
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    NanoCpus: 1_000_000_000,
    Memory: 1_073_741_824,
    PidsLimit: 64,
  });
  expect(inspected[0]?.Mounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Source: environment.checkout,
        Destination: "/workspace",
        RW: true,
      }),
      expect.objectContaining({
        Source: environment.state,
        Destination: "/state",
        RW: true,
      }),
      expect.objectContaining({
        Source: environment.output,
        Destination: "/output",
        RW: true,
      }),
    ]),
  );
  expect(inspected[0]?.Mounts.filter((mount) => mount.Source)).toHaveLength(3);
}
