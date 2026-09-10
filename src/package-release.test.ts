import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PackedFile {
  readonly path: string;
}

interface PackedPackage {
  readonly files: readonly PackedFile[];
  readonly name: string;
  readonly version: string;
}

function packDryRun(): PackedPackage {
  const result = spawnSync(
    "pnpm",
    ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `package dry run failed: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as PackedPackage;
}

describe("npm package", () => {
  it("cleans obsolete output without touching other project files", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "striker-clean-"));
    const staleOutput = path.join(projectRoot, "dist/stale.js");
    const retained = path.join(projectRoot, "retained.txt");
    await mkdir(path.dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale\n");
    await writeFile(retained, "keep\n");

    const clean = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../clean-dist.js", import.meta.url)),
        projectRoot,
      ],
      { encoding: "utf8" },
    );

    expect(clean.status, clean.stderr).toBe(0);
    await expect(access(staleOutput)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(retained, "utf8")).resolves.toBe("keep\n");
  });

  it("packs the public runtime without maintainer-only files", () => {
    const packed = packDryRun();
    const paths = packed.files.map((file) => file.path);

    expect(packed.name).toBe("@useless_mob/striker");
    expect(packed.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(packed.version).not.toBe("0.0.0");
    expect(paths).toEqual(
      expect.arrayContaining([
        "LICENSE",
        "README.md",
        "dist/cli.js",
        "dist/index.d.ts",
        "dist/index.js",
        "plan.schema.json",
        "schema.json",
        "runtime/Dockerfile",
        "runtime/baseline.json",
        "runtime/.dockerignore",
        "runtime/install.mjs",
        "runtime/probe.mjs",
        "skills/striker/SKILL.md",
        "skills/striker-implementor/SKILL.md",
      ]),
    );
    expect(paths).not.toContain("PUBLISHING.md");
    expect(paths.some((file) => file.startsWith("src/"))).toBe(false);
    expect(paths.some((file) => file.includes(".test."))).toBe(false);
  });
});
