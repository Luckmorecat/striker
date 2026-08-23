import { lstat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createPublicSkillInstaller } from "../skills/public-skill-installer.js";
import { runCli } from "./program.js";

const installedFiles = {
  "striker-plan/BOOTSTRAP.md": "bootstrap\n",
  "striker-plan/PLAN-FORMAT.md": "plan format\n",
  "striker-plan/SKILL.md": "striker plan\n",
  "striker-plan/agents/openai.yaml": "plan metadata\n",
  "striker-preparation/BRIEF-FORMAT.md": "brief format\n",
  "striker-preparation/SKILL.md": "striker preparation\n",
  "striker-preparation/SPEC-FORMAT.md": "spec format\n",
  "striker-preparation/agents/openai.yaml": "preparation metadata\n",
  "striker-shape/SKILL.md": "striker shape\n",
  "striker-shape/agents/openai.yaml": "shape metadata\n",
  "striker-spec/SKILL.md": "striker spec\n",
  "striker-spec/agents/openai.yaml": "spec metadata\n",
  "striker/SKILL.md": "striker\n",
  "striker/agents/openai.yaml": "striker metadata\n",
};

async function writeFiles(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }),
  );
}

async function expectFiles(root: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(installedFiles)) {
    expect(await readFile(path.join(root, relativePath), "utf8")).toBe(content);
  }
}

describe("striker skills install", () => {
  it("installs the complete public preparation set and shared references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-cli-skills-"));
    const projectRoot = path.join(root, "project");
    const skillsSourceRoot = path.join(root, "package", "skills");
    await mkdir(projectRoot, { recursive: true });
    await writeFiles(skillsSourceRoot, {
      ...installedFiles,
      "striker-implementor/SKILL.md": "private implementor\n",
    });
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(
      ["skills", "install", "--harness", "claude"],
      {
        cwd: projectRoot,
        permissionConfig: {
          read: () => Promise.resolve("attended"),
          write: () => Promise.resolve(),
        },
        planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
        stderr: { write: (text) => (stderr += text) },
        skillInstaller: createPublicSkillInstaller(skillsSourceRoot),
        stdout: { write: (text) => (stdout += text) },
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe("Installed public Striker skills.\n");
    expect(stderr).toBe("");
    await expectFiles(path.join(projectRoot, ".agents/skills"));
    await expectFiles(path.join(projectRoot, ".claude/skills"));
    await expect(
      lstat(path.join(projectRoot, ".agents/skills/striker-implementor")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(path.join(projectRoot, ".claude/skills/striker-implementor")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
