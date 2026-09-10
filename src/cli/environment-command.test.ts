import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runCli } from "./program.js";
import { createEnvironmentPreparer } from "../infrastructure/docker/environment-preparer.js";
import { loadBaseline } from "../infrastructure/docker/baseline.js";

it("prepares the selected local image only after explicit approval and records its ID", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-prepare-cli-"));
  let imageId = `sha256:${"a".repeat(64)}`;
  let probes = 0;
  await writeFile(
    path.join(root, "striker.config.json"),
    JSON.stringify({ taskSource: "striker-plan", image: "my-image:local" }),
  );
  const handler = createEnvironmentPreparer({
    projectRoot: root,
    stateRoot: path.join(root, "private"),
    docker: async (args) => {
      if (args[0] === "image")
        return JSON.stringify([
          {
            Id: imageId,
            Os: "linux",
            Config: {
              Labels: {
                "org.striker.baseline": (await loadBaseline()).identity,
              },
            },
          },
        ]);
      if (args[0] === "run") probes++;
      return "";
    },
  });
  let output = "";
  let error = "";
  const dependencies = {
    cwd: root,
    environmentPreparer: handler,
    permissionConfig: {
      read: () => Promise.resolve("attended" as const),
      write: () => Promise.resolve(),
    },
    planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
    skillInstaller: {
      supportedHarnesses: [],
      install: () => Promise.resolve({ changed: false }),
    },
    stdout: {
      write: (text: string) => {
        output += text;
      },
    },
    stderr: {
      write: (text: string) => {
        error += text;
      },
    },
  };
  expect(await runCli(["environment", "prepare"], dependencies)).toBe(1);
  expect(error).toContain("--approve-image");
  expect(probes).toBe(0);
  expect(
    await runCli(["environment", "prepare", "--approve-image"], dependencies),
  ).toBe(0);
  expect(output).toContain(imageId);
  expect(
    JSON.parse(
      await readFile(path.join(root, "private/prepared-image.json"), "utf8"),
    ),
  ).toMatchObject({ imageId });
  expect(await runCli(["environment", "prepare"], dependencies)).toBe(0);
  imageId = `sha256:${"b".repeat(64)}`;
  expect(await runCli(["environment", "prepare"], dependencies)).toBe(1);
  expect(probes).toBe(2);
});
