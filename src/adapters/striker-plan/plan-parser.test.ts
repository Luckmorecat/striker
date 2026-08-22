import { mkdtemp, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
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

const ledger = {
  assumptions: {
    A1: {
      evidence: [{ line: 10, path: "src/cli.ts" }],
      statement: "The CLI owns command registration.",
    },
  },
  defaults: {
    D1: {
      reason: "The existing commands use it.",
      reversalCost: "Update the command and its tests.",
      statement: "Keep the current command naming style.",
    },
  },
};

function manifest(tasks = ["tasks/01-bootstrap.md"]): string {
  return JSON.stringify({
    ...ledger,
    taskSource: "striker-plan",
    tasks,
    version: 2,
  });
}

async function createPlan(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-plan-"));
  await mkdir(path.join(root, "tasks"));
  await Promise.all([
    writeFile(path.join(root, "plan.json"), manifest()),
    writeFile(path.join(root, "spine.md"), "# Spine\n"),
    writeFile(path.join(root, "map.md"), "# Map\n"),
    writeFile(path.join(root, "tasks/01-bootstrap.md"), completeTask),
  ]);
  return root;
}

describe("parseStrikerPlan task extraction", () => {
  it("extracts ordered implementation tasks from a complete plan directory", async () => {
    const root = await createPlan();

    const plan = await parseStrikerPlan(root);

    expect(plan.manifest.tasks).toEqual(["tasks/01-bootstrap.md"]);
    expect(plan.identity).toMatch(/^[a-f\d]{64}$/);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      affectedPaths: ["src/cli.ts"],
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

  it("derives a stable identity from every immutable file", async () => {
    const firstRoot = await createPlan();
    const secondRoot = await createPlan();
    const baseline = await parseStrikerPlan(firstRoot);

    expect((await parseStrikerPlan(secondRoot)).identity).toBe(
      baseline.identity,
    );

    const changes = [
      {
        changed: manifest().replace("current command", "nearby command"),
        original: manifest(),
        path: "plan.json",
      },
      {
        changed: "# Changed spine\n",
        original: "# Spine\n",
        path: "spine.md",
      },
      { changed: "# Changed map\n", original: "# Map\n", path: "map.md" },
      {
        changed: completeTask.replace("first", "initial"),
        original: completeTask,
        path: "tasks/01-bootstrap.md",
      },
    ];
    for (const change of changes) {
      await writeFile(path.join(secondRoot, change.path), change.changed);
      const changed = await parseStrikerPlan(secondRoot);
      expect(changed.identity).not.toBe(baseline.identity);
      if (change.path === "tasks/01-bootstrap.md") {
        expect(changed.tasks[0]?.identity.revision).not.toBe(
          baseline.tasks[0]?.identity.revision,
        );
      } else {
        expect(changed.tasks[0]?.identity.revision).toBe(
          baseline.tasks[0]?.identity.revision,
        );
      }
      await writeFile(path.join(secondRoot, change.path), change.original);
    }
  });
});

describe("parseStrikerPlan file validation", () => {
  it.each([
    [
      "assumption",
      `{"assumptions":{"A1":${JSON.stringify(ledger.assumptions.A1)},"A\\u0031":${JSON.stringify(ledger.assumptions.A1)}},"defaults":{},"taskSource":"striker-plan","tasks":["tasks/01-bootstrap.md"],"version":2}`,
      "duplicate JSON object key: assumptions.A1",
    ],
    [
      "default",
      `{"assumptions":{},"defaults":{"D1":${JSON.stringify(ledger.defaults.D1)},"D1":${JSON.stringify(ledger.defaults.D1)}},"taskSource":"striker-plan","tasks":["tasks/01-bootstrap.md"],"version":2}`,
      "duplicate JSON object key: defaults.D1",
    ],
  ])("rejects duplicate %s IDs in raw plan JSON", async (_kind, raw, error) => {
    const root = await createPlan();
    await writeFile(path.join(root, "plan.json"), raw);

    await expect(parseStrikerPlan(root)).rejects.toThrow(error);
  });

  it("rejects Markdown task files missing from the manifest", async () => {
    const root = await createPlan();
    await writeFile(path.join(root, "02-undeclared.md"), completeTask);

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "undeclared task files: 02-undeclared.md",
    );
  });

  it("rejects undeclared Markdown nested in the plan", async () => {
    const root = await createPlan();
    await mkdir(path.join(root, "notes"));
    await writeFile(path.join(root, "notes/design.md"), "# Notes\n");

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "undeclared task files: notes/design.md",
    );
  });

  it("rejects a plan-local log as undeclared Markdown", async () => {
    const root = await createPlan();
    await writeFile(path.join(root, "log.md"), "# Log\n");

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "undeclared task files: log.md",
    );
  });

  it("rejects a directory without a manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-no-manifest-"));

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "missing file: plan.json",
    );
  });

  it.each(["spine.md", "map.md"])("rejects a plan missing %s", async (file) => {
    const root = await createPlan();
    await unlink(path.join(root, file));

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      `missing file: ${file}`,
    );
  });

  it("rejects a support file declared as a task", async () => {
    const root = await createPlan();
    await writeFile(path.join(root, "spine.md"), completeTask);
    await writeFile(path.join(root, "plan.json"), manifest(["spine.md"]));

    await expect(parseStrikerPlan(root)).rejects.toThrow();
  });

  it("rejects a declared task file that is missing", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "plan.json"),
      manifest(["tasks/02-missing.md"]),
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

  it("normalizes affected paths and rejects repository escapes", async () => {
    const root = await createPlan();
    await writeFile(
      path.join(root, "tasks/01-bootstrap.md"),
      completeTask.replace("- src/cli.ts", "- Modify `./src/cli.ts`"),
    );
    expect((await parseStrikerPlan(root)).tasks[0]?.affectedPaths).toEqual([
      "src/cli.ts",
    ]);

    await writeFile(
      path.join(root, "tasks/01-bootstrap.md"),
      completeTask.replace("- src/cli.ts", "- `/tmp/outside.ts`"),
    );
    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "Path must be repository-relative POSIX",
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
      manifest(["tasks/02-link.md"]),
    );

    await expect(parseStrikerPlan(root)).rejects.toThrow(
      "task path escapes the plan directory: tasks/02-link.md",
    );
  });
});
