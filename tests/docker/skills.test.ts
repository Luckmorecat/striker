import { mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { prepareHarnessLaunch } from "../../src/runner/worker/harness-launch.js";

for (const harness of ["codex", "pi"] as const)
  test(`${harness} catalog includes only curated resources and preserves repository instructions`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-skills-"));
    let id: string | undefined;
    try {
      const environment = await new DockerEnvironment().allocate({
        runId: `skills-${harness}`,
        stateRoot: root,
        image: await prepareImage(),
        resources: { cpus: 1, memoryMiB: 1024, pids: 64 },
      });
      id = environment.environmentId;
      for (const [base, name] of [
        [environment.inputs, "chosen"],
        [environment.inputs, "striker-implementor"],
        [path.join(environment.checkout, ".agents"), "unconfigured"],
      ] as const) {
        const directory = path.join(base, "skills", name);
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, "SKILL.md"),
          `---\nname: ${name}\ndescription: Test skill\n---\n${name} instructions`,
        );
      }
      const sentinel = path.join(
        root,
        "personal/.agents/skills/personal/SKILL.md",
      );
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(
        sentinel,
        "---\nname: personal\ndescription: Private skill\n---\npersonal secret",
      );
      await mkdir(path.join(environment.checkout, ".pi/extensions"), {
        recursive: true,
      });
      await writeFile(
        path.join(environment.checkout, ".pi/extensions/unconfigured.ts"),
        'import {writeFileSync} from "node:fs"; writeFileSync("/workspace/extension-leaked", "bad"); export default () => {};',
      );
      await writeFile(
        path.join(environment.checkout, "AGENTS.md"),
        "PRESERVED_REPOSITORY_INSTRUCTIONS",
      );
      await writeFile(
        path.join(environment.inputs, "context.json"),
        JSON.stringify({
          skills: [{ name: "chosen" }, { name: "striker-implementor" }],
        }),
      );
      await copyFile(
        fileURLToPath(new URL("./skills-client.mjs", import.meta.url)),
        path.join(environment.inputs, "skills-client.mjs"),
      );
      await prepareHarnessLaunch(environment.state, {
        harness,
        model: "gpt-5.6-sol",
        effort: "low",
        token: "fake-run-key",
        isolated: true,
      });
      await dockerCommand(["start", id]);
      const output = await dockerCommand([
        "exec",
        "--env",
        `STRIKER_HOST_SENTINEL=${sentinel}`,
        id,
        "node",
        "/opt/striker/gateway-bridge.mjs",
        "node",
        "/opt/striker/run/skills-client.mjs",
      ]);
      expect(output).toContain(`${harness}-catalog-ok`);
    } finally {
      try {
        if (id) await dockerCommand(["rm", "--force", id]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 600_000);
