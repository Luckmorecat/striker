import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadImplementorWorkflow } from "./workflow-loader.js";

describe("private implementor workflow", () => {
  it("loads the entrypoint and packaged TDD reference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-workflow-"));
    await mkdir(path.join(root, "references"));
    await Promise.all([
      writeFile(
        path.join(root, "SKILL.md"),
        "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nimplement one task",
      ),
      writeFile(path.join(root, "references/tdd.md"), "red then green"),
    ]);

    await expect(loadImplementorWorkflow(root)).resolves.toBe(
      "---\nname: striker-implementor\ndescription: Implement one task.\n---\n\nimplement one task\n\nred then green",
    );
  });

  it("loads and validates the packaged workflow asset", async () => {
    const root = fileURLToPath(
      new URL("../../../skills/striker-implementor", import.meta.url),
    );

    const workflow = await loadImplementorWorkflow(root);

    expect(workflow).toContain("name: striker-implementor");
    expect(workflow).toContain("# Test-first implementation");
    expect(workflow).not.toContain("# Sequential review");
  });
});
