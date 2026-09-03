import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

import type { ImplementationTask, TaskIdentity } from "../../core/contracts.js";
import type { OutcomeRoute } from "../../core/outcome-contracts.js";
import { rejectDuplicateJsonKeys } from "./json-object-keys.js";
import { parsePlanManifest, type PlanManifest } from "./plan-manifest.js";

const supportFiles = ["spine.md", "map.md"] as const;
const requiredSections = ["Build", "Paths", "Test contract", "Verify"] as const;
type SectionName = (typeof requiredSections)[number];
type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];
type TaskSections = Map<SectionName, MarkdownNode[]>;

export interface StrikerPlanTask extends ImplementationTask {
  readonly affectedPaths: readonly string[];
  readonly path: string;
  readonly verifyCommand: string;
}

function collectListItems(nodes: readonly MarkdownNode[]): string[] {
  const items: string[] = [];
  const visit = (node: MarkdownNode): void => {
    if (node.type === "listItem") items.push(nodeText(node).trim());
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as MarkdownNode[]) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return items;
}

function parseAffectedPaths(
  taskPath: string,
  sections: TaskSections,
): string[] {
  const entries = collectListItems(sections.get("Paths") ?? []);
  const paths = entries.map((entry) => {
    const value = entry
      .replace(/^(?:Create|Modify|Delete)\s+/i, "")
      .replace(/^`|`$/g, "")
      .trim();
    if (
      value.includes("\\") ||
      path.posix.isAbsolute(value) ||
      /^[A-Za-z]:/.test(value)
    ) {
      throw taskError(
        taskPath,
        `Path must be repository-relative POSIX: ${value}`,
      );
    }
    const normalized = path.posix.normalize(value);
    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw taskError(taskPath, `Path escapes the repository: ${value}`);
    }
    return normalized;
  });
  if (paths.length === 0 || paths.some((entry) => entry.length === 0)) {
    throw taskError(taskPath, "Paths must contain concrete list items");
  }
  return paths;
}

export interface StrikerPlan {
  readonly identity: string;
  readonly manifest: PlanManifest;
  readonly outcomeRoutes: readonly OutcomeRoute[];
  readonly tasks: readonly StrikerPlanTask[];
}

function resolveOutcomeRoutes(
  manifest: PlanManifest,
  tasks: readonly StrikerPlanTask[],
): readonly OutcomeRoute[] {
  const identities = new Map(tasks.map((task) => [task.path, task.identity]));
  return manifest.outcomeRoutes.map((route) => {
    const from = identities.get(route.from);
    const to = route.to.map((target) => identities.get(target));
    if (from === undefined || to.some((target) => target === undefined)) {
      throw new PlanValidationError("Outcome Route contains an unknown task");
    }
    return { from, to: to as TaskIdentity[] };
  });
}

export class PlanValidationError extends Error {
  override readonly name = "PlanValidationError";
}

function nodeText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map((child: unknown) => nodeText(child)).join("");
}

function taskError(taskPath: string, message: string): PlanValidationError {
  return new PlanValidationError(`${taskPath}: ${message}`);
}

function parseTitle(
  taskPath: string,
  children: readonly MarkdownNode[],
): string {
  const titleHeadings = children.filter(
    (node) => node.type === "heading" && node.depth === 1,
  );
  if (titleHeadings.length !== 1 || children[0] !== titleHeadings[0]) {
    throw taskError(taskPath, "expected one leading level-one title");
  }
  const title = nodeText(titleHeadings[0]).trim();
  if (title.length === 0) throw taskError(taskPath, "title cannot be empty");
  return title;
}

function parseSections(
  taskPath: string,
  children: readonly MarkdownNode[],
): TaskSections {
  const sections: TaskSections = new Map();
  let current: SectionName | undefined;
  let sectionIndex = 0;
  for (const node of children.slice(1)) {
    if (node.type === "heading" && node.depth === 2) {
      const sectionName = nodeText(node);
      const expected = requiredSections[sectionIndex];
      if (expected === undefined) {
        throw taskError(taskPath, `unexpected section: ${sectionName}`);
      }
      if (sectionName !== expected) {
        throw taskError(
          taskPath,
          `expected section ${expected}, found ${sectionName}`,
        );
      }
      current = expected;
      sections.set(current, []);
      sectionIndex += 1;
    } else if (current === undefined) {
      throw taskError(taskPath, "content appears before the first section");
    } else {
      sections.get(current)?.push(node);
    }
  }
  for (const sectionName of requiredSections) {
    const nodes = sections.get(sectionName);
    if (nodes === undefined || nodes.length === 0) {
      throw taskError(taskPath, `missing or empty section: ${sectionName}`);
    }
  }
  return sections;
}

function parseVerifyCommand(taskPath: string, sections: TaskSections): string {
  const verifyNodes = sections.get("Verify") ?? [];
  const codeBlocks = verifyNodes.filter((node) => node.type === "code");
  const verifyBlock = codeBlocks[0];
  if (
    codeBlocks.length !== 1 ||
    verifyBlock === undefined ||
    (verifyBlock.lang !== "sh" &&
      verifyBlock.lang !== "bash" &&
      verifyBlock.lang !== "shell") ||
    verifyBlock.value.trim().length === 0
  ) {
    throw taskError(
      taskPath,
      "Verify must contain one nonempty shell code block",
    );
  }
  return verifyBlock.value.trim();
}

function parseTask(taskPath: string, content: string): StrikerPlanTask {
  const children = fromMarkdown(content).children;
  const title = parseTitle(taskPath, children);
  const sections = parseSections(taskPath, children);
  const verifyCommand = parseVerifyCommand(taskPath, sections);

  return {
    affectedPaths: parseAffectedPaths(taskPath, sections),
    identity: {
      id: taskPath,
      revision: createHash("sha256").update(content).digest("hex"),
    },
    instructions: content,
    path: taskPath,
    title,
    verifyCommand,
  };
}

function parseJson(content: Buffer): unknown {
  try {
    const source = content.toString("utf8");
    rejectDuplicateJsonKeys(source);
    return JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlanValidationError(`cannot parse plan.json: ${message}`);
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function requireFile(
  root: string,
  realRoot: string,
  relativePath: string,
): Promise<string> {
  const candidate = path.join(root, relativePath);
  try {
    if (!(await stat(candidate)).isFile()) throw new Error();
  } catch {
    throw new PlanValidationError(`missing file: ${relativePath}`);
  }
  const resolved = await realpath(candidate);
  if (!isWithinRoot(realRoot, resolved)) {
    throw new PlanValidationError(
      `task path escapes the plan directory: ${relativePath}`,
    );
  }
  return resolved;
}

async function markdownFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(root, entryPath)));
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      entry.name.endsWith(".md")
    ) {
      files.push(path.relative(root, entryPath).split(path.sep).join("/"));
    }
  }
  return files;
}

async function rejectUndeclaredTasks(
  root: string,
  manifest: PlanManifest,
): Promise<void> {
  const declared = new Set<string>([...supportFiles, ...manifest.tasks]);
  const undeclared = (await markdownFiles(root)).filter(
    (filePath) => !declared.has(filePath),
  );
  if (undeclared.length > 0) {
    throw new PlanValidationError(
      `undeclared task files: ${undeclared.sort().join(", ")}`,
    );
  }
}

async function readImmutableFiles(
  paths: readonly string[],
  resolvedFiles: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>();
  await Promise.all(
    paths.map(async (filePath) => {
      const resolved = resolvedFiles.get(filePath);
      if (resolved === undefined) {
        throw new PlanValidationError(`missing file: ${filePath}`);
      }
      files.set(filePath, await readFile(resolved));
    }),
  );
  return files;
}

function planIdentity(
  paths: readonly string[],
  files: ReadonlyMap<string, Buffer>,
): string {
  const hash = createHash("sha256");
  for (const filePath of paths) {
    const content = files.get(filePath);
    if (content === undefined) {
      throw new PlanValidationError(`missing file: ${filePath}`);
    }
    hash.update(`${String(Buffer.byteLength(filePath))}:`);
    hash.update(filePath);
    hash.update(`${String(content.byteLength)}:`);
    hash.update(content);
  }
  return hash.digest("hex");
}

export async function parseStrikerPlan(root: string): Promise<StrikerPlan> {
  const realRoot = await realpath(root);
  const resolvedFiles = new Map<string, string>();
  const manifestPath = await requireFile(root, realRoot, "plan.json");
  const manifestBytes = await readFile(manifestPath);
  resolvedFiles.set("plan.json", manifestPath);
  const manifest = parsePlanManifest(parseJson(manifestBytes));
  const immutablePaths = ["plan.json", ...supportFiles, ...manifest.tasks];
  for (const filePath of immutablePaths.slice(1)) {
    resolvedFiles.set(filePath, await requireFile(root, realRoot, filePath));
  }
  await rejectUndeclaredTasks(root, manifest);
  const files = new Map(
    await readImmutableFiles(immutablePaths.slice(1), resolvedFiles),
  );
  files.set("plan.json", manifestBytes);
  const tasks = manifest.tasks.map((taskPath) => {
    const content = files.get(taskPath);
    if (content === undefined) {
      throw new PlanValidationError(`missing file: ${taskPath}`);
    }
    return parseTask(taskPath, content.toString("utf8"));
  });
  return {
    identity: planIdentity(immutablePaths, files),
    manifest,
    outcomeRoutes: resolveOutcomeRoutes(manifest, tasks),
    tasks,
  };
}
