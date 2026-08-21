import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseStrikerPlan } from "./plan-parser.js";

const completeTask = `# Bootstrap the CLI

## Build

Add the first command.

## Paths

- src/cli.ts

## Test contract

- Validate through the command boundary.

## Verify

\`\`\`sh
pnpm test
\`\`\`
`;

async function createPlan(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-"));
  await mkdir(path.join(root, "tasks"));
  await Promise.all([
    writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/01-bootstrap.md"],
        version: 1,
      }),
    ),
    writeFile(path.join(root, "spine.md"), "# Spine\n"),
    writeFile(path.join(root, "map.md"), "# Map\n"),
    writeFile(path.join(root, "log.md"), "# Log\n"),
    writeFile(path.join(root, "tasks/01-bootstrap.md"), completeTask),
  ]);
  return root;
}

describe("parseStrikerPlan task extraction", () => {
  it("extracts ordered implementation tasks from a complete plan directory", async () => {
    const root = await createPlan();

    const plan = await parseStrikerPlan(root);

    expect(plan.manifest.tasks).toEqual(["tasks/01-bootstrap.md"]);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      identity: {
        id: "tasks/01-bootstrap.md",
      },
      instructions: completeTask,
      path: "tasks/01-bootstrap.md",
      title: "Bootstrap the CLI",
      verifyCommand: "pnpm test",
    });
    expect(plan.tasks[0]?.identity.revision).toMatch(/^[a-f\d]{64}$/);
  });
});

describe("parseStrikerPlan file validation", () => {
  it("rejects Markdown task files missing from the manifest", async () => {
    const root = await createPlan();
    await writeFile(path.join(root, "02-undeclared.md"), completeTask);

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "undeclared task files: 02-undeclared.md",
    );
  });

  it("rejects a directory without a manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-no-manifest-"));

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "cannot read plan.json",
    );
  });

  it("rejects a support file declared as a task", async () => {
    const root = await createPlan();
    await writeFile(path.join(root, "spine.md"), completeTask);
    await writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["spine.md"],
        version: 1,
      }),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow();
  });

  it("rejects a declared task file that is missing", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/02-missing.md"],
        version: 1,
      }),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "missing file: tasks/02-missing.md",
    );
  });
});

describe("parseStrikerPlan task format", () => {
  it("rejects a task without every required section", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "tasks/01-bootstrap.md"),
      completeTask.replace("## Test contract", "## Tests"),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "expected section Test contract, found Tests",
    );
  });

  it("rejects more than one code block in Verify", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "tasks/01-bootstrap.md"),
      completeTask.replace(
        "pnpm test\n```",
        "pnpm test\n```\n\n```sh\npnpm build\n```",
      ),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "Verify must contain one nonempty shell code block",
    );
  });

  it("rejects required sections in a different order", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "tasks/01-bootstrap.md"),
      completeTask
        .replace("## Build", "## Temporary")
        .replace("## Paths", "## Build")
        .replace("## Temporary", "## Paths"),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "expected section Build, found Paths",
    );
  });
});

describe("parseStrikerPlan containment", () => {
  it("rejects an undeclared Markdown symlink", async () => {
    const root = await createPlan();
    const externalRoot = await mkdtemp(
      path.join(tmpdir(), "striker-undeclared-link-"),
    );
    const externalTask = path.join(externalRoot, "task.md");
    await writeFile(externalTask, completeTask);
    await symlink(externalTask, path.join(root, "02-undeclared.md"));

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "undeclared task files: 02-undeclared.md",
    );
  });

  it("rejects a declared symlink that escapes the plan directory", async () => {
    const root = await createPlan();
    const externalRoot = await mkdtemp(
      path.join(tmpdir(), "striker-external-"),
    );
    const externalTask = path.join(externalRoot, "task.md");
    await writeFile(externalTask, completeTask);
    await symlink(externalTask, path.join(root, "tasks/02-link.md"));
    await writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        taskSource: "striker-plan",
        tasks: ["tasks/02-link.md"],
        version: 1,
      }),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "task path escapes the plan directory: tasks/02-link.md",
    );
  });
});
