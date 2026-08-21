import { lstat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  installPublicSkills,
  type SupportedHarness,
} from "./public-skill-installer.js";

async function fixture(): Promise<{ projectRoot: string; sourceRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-skills-"));
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "packaged-skills");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(path.join(sourceRoot, "striker"), { recursive: true }),
    mkdir(path.join(sourceRoot, "striker-plan"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(sourceRoot, "striker/SKILL.md"), "# Striker\n"),
    writeFile(
      path.join(sourceRoot, "striker-plan/SKILL.md"),
      "# Striker plan\n",
    ),
  ]);
  return { projectRoot, sourceRoot };
}

const harnessSkillRoots: Record<SupportedHarness, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
  opencode: ".agents/skills",
  pi: ".agents/skills",
};

describe("installPublicSkills", () => {
  it.each(Object.entries(harnessSkillRoots))(
    "installs both public skills for %s without unrelated harness paths",
    async (harness, harnessRoot) => {
      const fixturePaths = await fixture();

      const result = await installPublicSkills({
        ...fixturePaths,
        harness: harness as SupportedHarness,
      });

      expect(result.changed).toBe(true);
      expect(
        await readFile(
          path.join(fixturePaths.projectRoot, harnessRoot, "striker/SKILL.md"),
          "utf8",
        ),
      ).toBe("# Striker\n");
      expect(
        await readFile(
          path.join(
            fixturePaths.projectRoot,
            harnessRoot,
            "striker-plan/SKILL.md",
          ),
          "utf8",
        ),
      ).toBe("# Striker plan\n");
      expect(
        await lstat(
          path.join(fixturePaths.projectRoot, ".agents/skills/striker"),
        ),
      ).toBeDefined();
      for (const redundantRoot of [
        ".codex/skills",
        ".opencode/skills",
        ".pi/skills",
      ]) {
        await expect(
          lstat(path.join(fixturePaths.projectRoot, redundantRoot)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      if (harness !== "claude") {
        await expect(
          lstat(path.join(fixturePaths.projectRoot, ".claude/skills")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );

  it("leaves an identical installation untouched", async () => {
    const fixturePaths = await fixture();
    await installPublicSkills({ ...fixturePaths, harness: "claude" });

    const result = await installPublicSkills({
      ...fixturePaths,
      harness: "claude",
    });

    expect(result.changed).toBe(false);
  });

  it("refuses divergent content before installing another skill", async () => {
    const fixturePaths = await fixture();
    const conflict = path.join(
      fixturePaths.projectRoot,
      ".agents/skills/striker/SKILL.md",
    );
    await mkdir(path.dirname(conflict), { recursive: true });
    await writeFile(conflict, "local instructions\n");

    await expect(
      installPublicSkills({ ...fixturePaths, harness: "codex" }),
    ).rejects.toThrow("conflicting skill destination");
    await expect(
      lstat(path.join(fixturePaths.projectRoot, ".agents/skills/striker-plan")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(conflict, "utf8")).toBe("local instructions\n");
  });
});
