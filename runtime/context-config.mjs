import { mkdir, readFile, readdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";

async function skillFiles(root, seen = new Set()) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const canonical = await realpath(root);
  if (seen.has(canonical)) return [];
  if (seen.size > 1000)
    throw new Error("Skill discovery exceeds resource limit");
  seen.add(canonical);
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.name === "SKILL.md") files.push(await realpath(target));
    else if (entry.isDirectory() || entry.isSymbolicLink())
      files.push(...(await skillFiles(target, seen)));
  }
  return files;
}

export async function isolatedContext(home, cwd) {
  const context = JSON.parse(
    await readFile("/opt/striker/run/context.json", "utf8"),
  );
  await mkdir(path.join(home, ".agents"), { recursive: true });
  await symlink(
    "/opt/striker/run/skills",
    path.join(home, ".agents/skills"),
  ).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const disabled = [];
  let parent = cwd;
  while (true) {
    for (const directory of [".agents/skills", ".codex/skills"])
      disabled.push(...(await skillFiles(path.join(parent, directory))));
    if (parent === "/") break;
    parent = path.dirname(parent);
  }
  return {
    codex: [
      "[skills.bundled]",
      "enabled = false",
      ...disabled.flatMap((file) => [
        "[[skills.config]]",
        `path = ${JSON.stringify(file)}`,
        "enabled = false",
      ]),
      `[projects.${JSON.stringify(cwd)}]`,
      'trust_level = "untrusted"',
    ],
    piArgs: [
      "--no-skills",
      "--no-extensions",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
      "--offline",
      "--extension",
      "/opt/striker/pi-search.mjs",
      ...context.skills.flatMap((skill) => [
        "--skill",
        `/opt/striker/run/skills/${skill.name}`,
      ]),
    ],
  };
}
