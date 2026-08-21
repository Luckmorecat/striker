import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
} from "node:fs/promises";
import path from "node:path";

import type { PublicSkillInstaller } from "../core/contracts.js";

export const supportedHarnesses = [
  "codex",
  "claude",
  "opencode",
  "pi",
] as const;
export type SupportedHarness = (typeof supportedHarnesses)[number];

const publicSkillNames = ["striker", "striker-plan"] as const;

function isSupportedHarness(harness: string): harness is SupportedHarness {
  return supportedHarnesses.some((candidate) => candidate === harness);
}

export interface PublicSkillInstallRequest {
  readonly harness: SupportedHarness;
  readonly projectRoot: string;
  readonly sourceRoot: string;
}

export interface PublicSkillInstallResult {
  readonly changed: boolean;
}

interface Destination {
  readonly destination: string;
  readonly source: string;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function sameTree(source: string, destination: string): Promise<boolean> {
  let sourceStat;
  let destinationStat;
  try {
    [sourceStat, destinationStat] = await Promise.all([
      lstat(source),
      lstat(destination),
    ]);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (sourceStat.isFile() && destinationStat.isFile()) {
    const [sourceContent, destinationContent] = await Promise.all([
      readFile(source),
      readFile(destination),
    ]);
    return sourceContent.equals(destinationContent);
  }
  if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) return false;
  const [sourceEntries, destinationEntries] = await Promise.all([
    readdir(source),
    readdir(destination),
  ]);
  sourceEntries.sort();
  destinationEntries.sort();
  if (sourceEntries.join("\0") !== destinationEntries.join("\0")) return false;
  const matches = await Promise.all(
    sourceEntries.map((entry) =>
      sameTree(path.join(source, entry), path.join(destination, entry)),
    ),
  );
  return matches.every(Boolean);
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function canonicalDestinations(
  request: PublicSkillInstallRequest,
): Destination[] {
  return publicSkillNames.map((skillName) => ({
    destination: path.join(request.projectRoot, ".agents", "skills", skillName),
    source: path.join(request.sourceRoot, skillName),
  }));
}

async function assertCanonicalDestinations(
  destinations: readonly Destination[],
): Promise<void> {
  for (const item of destinations) {
    if (!(await exists(item.source))) {
      throw new Error(`missing packaged skill: ${item.source}`);
    }
    if (
      (await exists(item.destination)) &&
      !(await sameTree(item.source, item.destination))
    ) {
      throw new Error(`conflicting skill destination: ${item.destination}`);
    }
  }
}

async function assertClaudeAliases(
  projectRoot: string,
  destinations: readonly Destination[],
): Promise<void> {
  for (const item of destinations) {
    const alias = path.join(
      projectRoot,
      ".claude",
      "skills",
      path.basename(item.destination),
    );
    if (!(await exists(alias))) continue;
    const aliasStat = await lstat(alias);
    const expected = path.relative(path.dirname(alias), item.destination);
    if (aliasStat.isSymbolicLink() && (await readlink(alias)) === expected)
      continue;
    if (await sameTree(item.source, alias)) continue;
    throw new Error(`conflicting skill destination: ${alias}`);
  }
}

async function installCanonical(
  destinations: readonly Destination[],
): Promise<boolean> {
  let changed = false;
  for (const item of destinations) {
    if (await exists(item.destination)) continue;
    await mkdir(path.dirname(item.destination), { recursive: true });
    await cp(item.source, item.destination, {
      errorOnExist: true,
      recursive: true,
    });
    changed = true;
  }
  return changed;
}

async function installClaudeAliases(
  projectRoot: string,
  destinations: readonly Destination[],
): Promise<boolean> {
  let changed = false;
  for (const item of destinations) {
    const alias = path.join(
      projectRoot,
      ".claude",
      "skills",
      path.basename(item.destination),
    );
    if (await exists(alias)) continue;
    await mkdir(path.dirname(alias), { recursive: true });
    await symlink(
      path.relative(path.dirname(alias), item.destination),
      alias,
      "dir",
    );
    changed = true;
  }
  return changed;
}

export async function installPublicSkills(
  request: PublicSkillInstallRequest,
): Promise<PublicSkillInstallResult> {
  const destinations = canonicalDestinations(request);
  await assertCanonicalDestinations(destinations);
  if (request.harness === "claude") {
    await assertClaudeAliases(request.projectRoot, destinations);
  }
  const canonicalChanged = await installCanonical(destinations);
  const aliasesChanged =
    request.harness === "claude"
      ? await installClaudeAliases(request.projectRoot, destinations)
      : false;
  return { changed: canonicalChanged || aliasesChanged };
}

export function createPublicSkillInstaller(
  sourceRoot: string,
): PublicSkillInstaller {
  return {
    supportedHarnesses,
    install: async (request) => {
      if (!isSupportedHarness(request.harness)) {
        throw new Error(`unsupported harness: ${request.harness}`);
      }
      return installPublicSkills({
        harness: request.harness,
        projectRoot: request.projectRoot,
        sourceRoot,
      });
    },
  };
}
