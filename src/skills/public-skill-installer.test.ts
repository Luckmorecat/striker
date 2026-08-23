import { lstat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  installPublicSkills,
  type SupportedHarness,
} from "./public-skill-installer.js";

const installedFiles = {
  "striker-plan/BOOTSTRAP.md": "# Bootstrap\n",
  "striker-plan/PLAN-FORMAT.md": "# Plan format\n",
  "striker-plan/SKILL.md": "# Striker plan\n",
  "striker-plan/agents/openai.yaml": "plan metadata\n",
  "striker-preparation/BRIEF-FORMAT.md": "# Brief format\n",
  "striker-preparation/SKILL.md": "# Striker preparation\n",
  "striker-preparation/SPEC-FORMAT.md": "# Spec format\n",
  "striker-preparation/agents/openai.yaml": "preparation metadata\n",
  "striker-shape/SKILL.md": "# Striker shape\n",
  "striker-shape/agents/openai.yaml": "shape metadata\n",
  "striker-spec/SKILL.md": "# Striker spec\n",
  "striker-spec/agents/openai.yaml": "spec metadata\n",
  "striker/SKILL.md": "# Striker\n",
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

async function fixture(): Promise<{ projectRoot: string; sourceRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-skills-"));
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "packaged-skills");
  await mkdir(projectRoot, { recursive: true });
  await writeFiles(sourceRoot, {
    ...installedFiles,
    "striker-implementor/SKILL.md": "# Private implementor\n",
  });
  return { projectRoot, sourceRoot };
}

const harnesses: readonly SupportedHarness[] = [
  "claude",
  "codex",
  "opencode",
  "pi",
];

describe("installPublicSkills", () => {
  it.each(harnesses)(
    "installs the complete public preparation set for %s",
    async (harness) => {
      const fixturePaths = await fixture();

      const result = await installPublicSkills({
        ...fixturePaths,
        harness,
      });

      expect(result.changed).toBe(true);
      await expectFiles(path.join(fixturePaths.projectRoot, ".agents/skills"));
      if (harness === "claude") {
        await expectFiles(
          path.join(fixturePaths.projectRoot, ".claude/skills"),
        );
      } else {
        await expect(
          lstat(path.join(fixturePaths.projectRoot, ".claude/skills")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      await expect(
        lstat(
          path.join(
            fixturePaths.projectRoot,
            ".agents/skills/striker-implementor",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      for (const redundantRoot of [
        ".codex/skills",
        ".opencode/skills",
        ".pi/skills",
      ]) {
        await expect(
          lstat(path.join(fixturePaths.projectRoot, redundantRoot)),
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
});

describe("installPublicSkills conflict handling", () => {
  it("refuses a late canonical conflict before copying another tree", async () => {
    const fixturePaths = await fixture();
    const conflict = path.join(
      fixturePaths.projectRoot,
      ".agents/skills/striker-preparation/BRIEF-FORMAT.md",
    );
    await mkdir(path.dirname(conflict), { recursive: true });
    await writeFile(conflict, "local instructions\n");

    await expect(
      installPublicSkills({ ...fixturePaths, harness: "codex" }),
    ).rejects.toThrow("conflicting skill destination");
    await expect(
      lstat(path.join(fixturePaths.projectRoot, ".agents/skills/striker")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(conflict, "utf8")).toBe("local instructions\n");
  });

  it("refuses a Claude alias conflict before copying canonical trees", async () => {
    const fixturePaths = await fixture();
    const conflict = path.join(
      fixturePaths.projectRoot,
      ".claude/skills/striker-preparation/BRIEF-FORMAT.md",
    );
    await mkdir(path.dirname(conflict), { recursive: true });
    await writeFile(conflict, "local instructions\n");

    await expect(
      installPublicSkills({ ...fixturePaths, harness: "claude" }),
    ).rejects.toThrow("conflicting skill destination");
    await expect(
      lstat(path.join(fixturePaths.projectRoot, ".agents/skills/striker")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(path.join(fixturePaths.projectRoot, ".claude/skills/striker")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(conflict, "utf8")).toBe("local instructions\n");
  });
});
