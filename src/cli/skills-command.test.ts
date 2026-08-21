import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createPublicSkillInstaller } from "../skills/public-skill-installer.js";
import { runCli } from "./program.js";

describe("striker skills install", () => {
  it("installs only the public skills for the selected harness", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-cli-skills-"));
    const projectRoot = path.join(root, "project");
    const skillsSourceRoot = path.join(root, "package", "skills");
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(path.join(skillsSourceRoot, "striker"), { recursive: true }),
      mkdir(path.join(skillsSourceRoot, "striker-plan"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(skillsSourceRoot, "striker/SKILL.md"), "striker\n"),
      writeFile(
        path.join(skillsSourceRoot, "striker-plan/SKILL.md"),
        "striker plan\n",
      ),
    ]);
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(
      ["skills", "install", "--harness", "claude"],
      {
        cwd: projectRoot,
        planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
        stderr: { write: (text) => (stderr += text) },
        skillInstaller: createPublicSkillInstaller(skillsSourceRoot),
        stdout: { write: (text) => (stdout += text) },
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe("Installed public Striker skills.\n");
    expect(stderr).toBe("");
    expect(
      await readFile(
        path.join(projectRoot, ".claude/skills/striker-plan/SKILL.md"),
        "utf8",
      ),
    ).toBe("striker plan\n");
  });
});
