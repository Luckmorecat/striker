import { describe, expect, it } from "vitest";

import { parseImplementationResult } from "./implementation-result.js";

describe("parseImplementationResult", () => {
  it("accepts one strict implementation result", () => {
    const result = {
      discoveries: [],
      kind: "implementation",
      outcomeFacts: [],
      summary: "Added the command and its public integration test.",
    } as const;

    expect(parseImplementationResult(JSON.stringify(result))).toEqual(result);
  });

  it("rejects prose, code fences, empty summaries, and unknown fields", () => {
    const result = {
      discoveries: [],
      kind: "implementation",
      outcomeFacts: [],
      summary: "Task complete.",
    };

    expect(() =>
      parseImplementationResult(`Done.\n${JSON.stringify(result)}`),
    ).toThrow("strict JSON object");
    expect(() =>
      parseImplementationResult(
        `\`\`\`json\n${JSON.stringify(result)}\n\`\`\``,
      ),
    ).toThrow("strict JSON object");
    expect(() =>
      parseImplementationResult(JSON.stringify({ ...result, summary: "" })),
    ).toThrow();
    expect(() =>
      parseImplementationResult(JSON.stringify({ ...result, commit: "abc" })),
    ).toThrow();
  });
});

describe("implementation discovery results", () => {
  it("accepts typed assumption and default discovery proposals", () => {
    const result = {
      discoveries: [
        {
          id: "A1",
          kind: "assumption",
          locator: {
            kind: "code",
            line: 12,
            path: "src/core/task.ts",
            text: "export const owner = core;",
          },
          reason: "The core module owns the transition.",
          state: "confirmed",
        },
        {
          deviation: "Retain the existing internal command name.",
          id: "D2",
          kind: "default",
          locator: {
            command: "pnpm check",
            exitCode: 0,
            kind: "verification",
            output: "Tests passed",
          },
        },
      ],
      kind: "implementation",
      outcomeFacts: [],
      summary: "Implemented the transition.",
    } as const;

    expect(parseImplementationResult(JSON.stringify(result))).toEqual(result);
  });

  it("rejects unsafe, empty, or duplicate discovery proposals", () => {
    const proposal = {
      id: "A1",
      kind: "assumption",
      locator: {
        kind: "code",
        line: 1,
        path: "../outside.ts",
        text: "evidence",
      },
      reason: "reason",
      state: "disproved",
    };
    expect(() =>
      parseImplementationResult(
        JSON.stringify({
          discoveries: [proposal],
          kind: "implementation",
          outcomeFacts: [],
          summary: "done",
        }),
      ),
    ).toThrow();
    expect(() =>
      parseImplementationResult(
        JSON.stringify({
          discoveries: [
            { ...proposal, locator: { ...proposal.locator, path: "src/a.ts" } },
            { ...proposal, locator: { ...proposal.locator, path: "src/b.ts" } },
          ],
          kind: "implementation",
          outcomeFacts: [],
          summary: "done",
        }),
      ),
    ).toThrow("one proposal per ledger entry");
  });
});

const outcomeFact = {
  category: "public_contract",
  evidence: {
    command: "pnpm check",
    exitCode: 0,
    kind: "verification",
    output: "ok",
  },
  id: "F1",
  relevantTo: ["tasks/02.md"],
  statement: "The verification contract is stable.",
} as const;

function parseFacts(outcomeFacts: unknown[]) {
  return parseImplementationResult(
    JSON.stringify({
      discoveries: [],
      kind: "implementation",
      outcomeFacts,
      summary: "done",
    }),
  );
}

describe("implementation outcome facts", () => {
  it("accepts bounded typed facts with task-local IDs and selected targets", () => {
    expect(
      parseFacts([
        {
          ...outcomeFact,
          evidence: {
            kind: "code",
            line: 12,
            path: "src/core/task.ts",
            text: "export const publicContract = true;",
          },
        },
      ]).outcomeFacts,
    ).toHaveLength(1);
  });

  it("rejects invalid IDs, categories, and target selections", () => {
    expect(() => parseFacts([{ ...outcomeFact, id: "F0" }])).toThrow();
    expect(() =>
      parseFacts([{ ...outcomeFact, category: "advice" }]),
    ).toThrow();
    expect(() => parseFacts([{ ...outcomeFact, relevantTo: [] }])).toThrow();
    expect(() =>
      parseFacts([
        { ...outcomeFact, relevantTo: ["tasks/02.md", "tasks/02.md"] },
      ]),
    ).toThrow();
    expect(() =>
      parseFacts([{ ...outcomeFact, relevantTo: ["src/task.ts"] }]),
    ).toThrow();
  });

  it("rejects every Outcome Fact protocol overflow", () => {
    expect(() =>
      parseFacts([
        {
          ...outcomeFact,
          relevantTo: Array.from(
            { length: 9 },
            (_, index) => `tasks/${String(index + 2)}.md`,
          ),
        },
      ]),
    ).toThrow();
    expect(() =>
      parseFacts([{ ...outcomeFact, statement: "x".repeat(501) }]),
    ).toThrow();
    expect(() =>
      parseFacts([
        {
          ...outcomeFact,
          evidence: { ...outcomeFact.evidence, output: "x".repeat(1_001) },
        },
      ]),
    ).toThrow();
    expect(() => parseFacts([outcomeFact, outcomeFact])).toThrow();
    expect(() =>
      parseFacts(
        Array.from({ length: 9 }, (_, id) => ({
          ...outcomeFact,
          id: `F${String(id + 1)}`,
        })),
      ),
    ).toThrow();
  });
});
