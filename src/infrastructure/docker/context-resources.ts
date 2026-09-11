import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";

export interface ContextResourceFile {
  readonly path: string;
  readonly content: string;
  readonly encoding?: "base64";
  readonly executable?: true;
}
export interface ContextSkill {
  readonly name: string;
  readonly files: readonly ContextResourceFile[];
}
export interface FrozenContextResources {
  readonly identity: string;
  readonly skills: readonly ContextSkill[];
}

async function readSkill(root: string, name: string): Promise<ContextSkill> {
  const directory = path.join(root, name);
  if (
    (await realpath(directory)) !== directory ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error(
      "Skill directories must be canonical and contain no symlinks",
    );
  const files: ContextResourceFile[] = [];
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(root, name, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
        throw new Error(
          "Skill resources cannot contain symlinks or special files",
        );
      if (entry.isDirectory()) await visit(child);
      else files.push(await readResource(path.join(root, name), child));
    }
  }
  await visit("");
  const entrypoint = files.find((file) => file.path === "SKILL.md");
  if (!entrypoint) throw new Error(`Missing SKILL.md for ${name}`);
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entrypoint.content)?.[1];
  if (metadata?.match(/^name:\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/m)?.[1] !== name)
    throw new Error(`Skill name must match its configured directory: ${name}`);
  return { name, files };
}

export async function resolveContextResources(request: {
  readonly packagedRoot: string;
  readonly projectRoot: string;
  readonly skills: readonly string[];
}): Promise<FrozenContextResources> {
  const packaged = await readdir(request.packagedRoot, { withFileTypes: true });
  const skills = await Promise.all(
    packaged
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readSkill(request.packagedRoot, entry.name)),
  );
  const names = new Set(skills.map((skill) => skill.name));
  for (const name of request.skills) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || names.has(name))
      throw new Error(`Invalid or ambiguous skill name: ${name}`);
    names.add(name);
    skills.push(
      await readSkill(path.join(request.projectRoot, ".agents/skills"), name),
    );
  }
  return {
    identity: createHash("sha256").update(JSON.stringify(skills)).digest("hex"),
    skills,
  };
}

async function readResource(
  root: string,
  relative: string,
): Promise<ContextResourceFile> {
  const file = path.join(root, relative);
  const bytes = await readFile(file);
  const executable = ((await lstat(file)).mode & 0o111) !== 0;
  return {
    path: relative,
    ...(isUtf8(bytes)
      ? { content: bytes.toString("utf8") }
      : { content: bytes.toString("base64"), encoding: "base64" as const }),
    ...(executable ? { executable: true as const } : {}),
  };
}
