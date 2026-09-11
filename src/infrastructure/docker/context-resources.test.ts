import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveContextResources } from "./context-resources.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-context-"));
  roots.push(root);
  const packaged = path.join(root, "packaged");
  const project = path.join(root, "project");
  for (const [base, name] of [
    [packaged, "striker-implementor"],
    [path.join(project, ".agents/skills"), "chosen"],
    [path.join(project, ".agents/skills"), "unconfigured"],
  ] as const) {
    const directory = path.join(base, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test skill\n---\n${name} instructions`,
    );
  }
  return { root, packaged, project };
}
test("freezes only packaged and explicitly selected project skill resources", async () => {
  const { packaged, project } = await fixture();
  const context = await resolveContextResources({
    packagedRoot: packaged,
    projectRoot: project,
    skills: ["chosen"],
  });
  expect(context.skills.map((skill) => skill.name)).toEqual([
    "striker-implementor",
    "chosen",
  ]);
  expect(context.skills[1]?.files).toEqual([
    {
      path: "SKILL.md",
      content:
        "---\nname: chosen\ndescription: Test skill\n---\nchosen instructions",
    },
  ]);
  await writeFile(
    path.join(project, ".agents/skills/chosen/SKILL.md"),
    "changed",
  );
  expect(context.skills[1]?.files[0]?.content).toContain("chosen instructions");
});
test("rejects missing, duplicate, escaping and symlinked skill resources", async () => {
  const { root, packaged, project } = await fixture();
  const resolve = (skills: readonly string[]) =>
    resolveContextResources({
      packagedRoot: packaged,
      projectRoot: project,
      skills,
    });
  for (const skills of [
    ["missing"],
    ["chosen", "chosen"],
    ["../chosen"],
    ["striker-implementor"],
  ] as const) {
    await expect(resolve(skills)).rejects.toThrow();
  }
  await symlink(root, path.join(project, ".agents/skills/chosen/escape"));
  await expect(resolve(["chosen"])).rejects.toThrow(/symlink/i);
});

test("rejects skill metadata that aliases another catalog entry", async () => {
  const { packaged, project } = await fixture();
  await writeFile(
    path.join(project, ".agents/skills/chosen/SKILL.md"),
    "---\nname: striker-implementor\ndescription: Alias\n---\ncontent",
  );
  await expect(
    resolveContextResources({
      packagedRoot: packaged,
      projectRoot: project,
      skills: ["chosen"],
    }),
  ).rejects.toThrow(/name/);
});

test("preserves binary assets and executable helpers in selected skills", async () => {
  const { packaged, project } = await fixture();
  const root = path.join(project, ".agents/skills/chosen");
  await writeFile(path.join(root, "asset.bin"), Buffer.from([255, 0, 128]));
  await writeFile(path.join(root, "helper.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(root, "helper.sh"), 0o700);
  const context = await resolveContextResources({
    packagedRoot: packaged,
    projectRoot: project,
    skills: ["chosen"],
  });
  expect(context.skills[1]?.files).toEqual(
    expect.arrayContaining([
      { path: "asset.bin", content: "/wCA", encoding: "base64" },
      { path: "helper.sh", content: "#!/bin/sh\nexit 0\n", executable: true },
    ]),
  );
});
