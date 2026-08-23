import { readFile } from "node:fs/promises";
import path from "node:path";

const workflowFiles = ["SKILL.md", "references/tdd.md"] as const;

function validateEntrypoint(content: string): void {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
  if (frontmatter === undefined) {
    throw new Error("Private implementor SKILL.md has no YAML frontmatter");
  }
  const fields = new Map(
    frontmatter.split("\n").map((line) => {
      const separator = line.indexOf(":");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );
  if (
    fields.get("name") !== "striker-implementor" ||
    fields.get("description") === undefined
  ) {
    throw new Error("Private implementor SKILL.md has invalid metadata");
  }
}

export async function loadImplementorWorkflow(root: string): Promise<string> {
  const sections = await Promise.all(
    workflowFiles.map(async (file) => {
      const content = await readFile(path.join(root, file), "utf8");
      if (content.trim().length === 0) {
        throw new Error(`Private implementor asset is empty: ${file}`);
      }
      return content.trim();
    }),
  );
  validateEntrypoint(sections[0] ?? "");
  return sections.join("\n\n");
}
