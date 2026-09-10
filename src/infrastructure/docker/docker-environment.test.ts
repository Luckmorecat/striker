import { mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DockerEnvironment } from "./docker-environment.js";
import { loadBaseline } from "./baseline.js";

it("allocates exclusive private mount directories and creates a restricted retained container", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-env-"));
  const calls: (readonly string[])[] = [];
  const image = {
    imageId: `sha256:${"a".repeat(64)}`,
    baselineId: (await loadBaseline()).identity,
  };
  const environment = new DockerEnvironment((args) => {
    calls.push(args);
    return Promise.resolve(
      args[0] === "image"
        ? JSON.stringify([
            {
              Id: image.imageId,
              Os: "linux",
              Config: { Labels: { "org.striker.baseline": image.baselineId } },
            },
          ])
        : "c".repeat(64),
    );
  });
  const request = {
    runId: "test-run",
    stateRoot: root,
    image,
    resources: { cpus: 2, memoryMiB: 1024, pids: 64 },
  };
  const result = await environment.allocate(request);
  expect(result.environmentId).toBe("c".repeat(64));
  expect((await stat(result.checkout)).mode & 0o777).toBe(0o700);
  expect(result.checkout).toBe(
    path.join(root, "environments/test-run/checkout"),
  );
  const create = calls.find((args) => args[0] === "create") ?? [];
  expect(create).toEqual(
    expect.arrayContaining([
      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--read-only",
      "--pull=never",
      "1024m",
    ]),
  );
  expect(create.filter((arg) => arg.startsWith("type=bind"))).toHaveLength(3);
  expect(
    await readFile(
      path.join(root, "environments/test-run/environment.json"),
      "utf8",
    ),
  ).toContain(image.imageId);
  await expect(environment.allocate(request)).rejects.toThrow();
  await expect(
    environment.allocate({ ...request, runId: "../escape" }),
  ).rejects.toThrow();
});

it("refuses artifact roots redirected through a symlink", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-env-link-"));
  await symlink(tmpdir(), path.join(root, "environments"));
  const environment = new DockerEnvironment(() => Promise.resolve(""));
  await expect(
    environment.allocate({
      runId: "test",
      stateRoot: root,
      image: {
        imageId: `sha256:${"a".repeat(64)}`,
        baselineId: "b".repeat(64),
      },
      resources: { cpus: 4, memoryMiB: 8192, pids: 512 },
    }),
  ).rejects.toThrow(/symlink/);
});
