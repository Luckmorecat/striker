import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parsePlanManifest, planManifestJsonSchema } from "../../index.js";

const validManifest = {
  assumptions: {
    A1: {
      evidence: [{ line: 12, path: "src/core/dispatcher.ts" }],
      statement: "The dispatcher owns task sequencing.",
    },
  },
  defaults: {
    D1: {
      reason: "It matches the adjacent command.",
      reversalCost: "Rename one internal option and its tests.",
      statement: "Use the existing option naming pattern.",
    },
  },
  taskSource: "striker-plan" as const,
  tasks: ["01-bootstrap.md", "nested/02-finish.md"],
  version: 2 as const,
};

describe("parsePlanManifest valid plans", () => {
  it("accepts a version 2 plan with typed ledger definitions", () => {
    expect(
      parsePlanManifest({
        $schema: "./node_modules/@useless_mob/striker/plan.schema.json",
        ...validManifest,
      }),
    ).toEqual({
      $schema: "./node_modules/@useless_mob/striker/plan.schema.json",
      ...validManifest,
    });
  });

  it("accepts empty assumption and default ledgers", () => {
    expect(
      parsePlanManifest({
        ...validManifest,
        assumptions: {},
        defaults: {},
      }),
    ).toMatchObject({ assumptions: {}, defaults: {} });
  });
});

describe("parsePlanManifest invalid plans", () => {
  it.each([
    ["an empty task list", { ...validManifest, tasks: [] }],
    ["version 1", { ...validManifest, version: 1 }],
    ["an unsupported source", { ...validManifest, taskSource: "markdown" }],
    ["an absolute task path", { ...validManifest, tasks: ["/tmp/01.md"] }],
    ["a traversing task path", { ...validManifest, tasks: ["tasks/../01.md"] }],
    ["duplicate task paths", { ...validManifest, tasks: ["01.md", "01.md"] }],
    ["a non-Markdown task path", { ...validManifest, tasks: ["01.txt"] }],
    ["a reserved support path", { ...validManifest, tasks: ["spine.md"] }],
    [
      "an array assumption ledger",
      {
        ...validManifest,
        assumptions: [validManifest.assumptions.A1],
      },
    ],
    [
      "a malformed assumption ID",
      {
        ...validManifest,
        assumptions: { A0: validManifest.assumptions.A1 },
      },
    ],
    [
      "a default ID used for an assumption",
      {
        ...validManifest,
        assumptions: { D1: validManifest.assumptions.A1 },
      },
    ],
    [
      "an array default ledger",
      {
        ...validManifest,
        defaults: [validManifest.defaults.D1],
      },
    ],
    [
      "a missing assumption ledger",
      {
        defaults: validManifest.defaults,
        taskSource: validManifest.taskSource,
        tasks: validManifest.tasks,
        version: validManifest.version,
      },
    ],
    [
      "a missing default ledger",
      {
        assumptions: validManifest.assumptions,
        taskSource: validManifest.taskSource,
        tasks: validManifest.tasks,
        version: validManifest.version,
      },
    ],
    ["an unknown manifest field", { ...validManifest, extra: true }],
    [
      "an unknown assumption field",
      {
        ...validManifest,
        assumptions: {
          A1: { ...validManifest.assumptions.A1, confidence: "high" },
        },
      },
    ],
  ])("rejects %s", (_description, manifest) => {
    expect(() => parsePlanManifest(manifest)).toThrow();
  });
});

describe("parsePlanManifest code evidence", () => {
  it.each([
    ["an empty evidence list", []],
    ["a zero line", [{ line: 0, path: "src/core/dispatcher.ts" }]],
    ["a fractional line", [{ line: 1.5, path: "src/core/dispatcher.ts" }]],
    ["an absolute path", [{ line: 1, path: "/src/core/dispatcher.ts" }]],
    ["a Windows path", [{ line: 1, path: "C:\\src\\dispatcher.ts" }]],
    ["a traversing path", [{ line: 1, path: "src/../dispatcher.ts" }]],
  ])("rejects %s", (_description, evidence) => {
    expect(() =>
      parsePlanManifest({
        ...validManifest,
        assumptions: {
          A1: { ...validManifest.assumptions.A1, evidence },
        },
      }),
    ).toThrow();
  });

  it.each([
    [
      "an assumption statement",
      {
        ...validManifest,
        assumptions: {
          A1: { ...validManifest.assumptions.A1, statement: "   " },
        },
      },
    ],
    [
      "a default statement",
      {
        ...validManifest,
        defaults: {
          D1: { ...validManifest.defaults.D1, statement: "\t" },
        },
      },
    ],
    [
      "a default reason",
      {
        ...validManifest,
        defaults: { D1: { ...validManifest.defaults.D1, reason: "\n" } },
      },
    ],
    [
      "a default reversal cost",
      {
        ...validManifest,
        defaults: {
          D1: { ...validManifest.defaults.D1, reversalCost: " " },
        },
      },
    ],
  ])("rejects whitespace-only text in %s", (_description, manifest) => {
    expect(() => parsePlanManifest(manifest)).toThrow();
  });
});

describe("planManifestJsonSchema", () => {
  it("publishes ledger key and nonblank text constraints", () => {
    expect(planManifestJsonSchema).toMatchObject({
      properties: {
        assumptions: {
          additionalProperties: {
            properties: { statement: { pattern: "\\S" } },
          },
          propertyNames: { pattern: "^A[1-9]\\d*$" },
          type: "object",
        },
        defaults: {
          additionalProperties: {
            properties: {
              reason: { pattern: "\\S" },
              reversalCost: { pattern: "\\S" },
              statement: { pattern: "\\S" },
            },
          },
          propertyNames: { pattern: "^D[1-9]\\d*$" },
          type: "object",
        },
      },
    });
  });

  it("keeps the packaged JSON Schema derived from the Zod schema", async () => {
    const packaged = JSON.parse(
      await readFile(
        new URL("../../../plan.schema.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(packaged).toEqual(planManifestJsonSchema);
    expect(packaged).not.toHaveProperty("$id");
  });
});
