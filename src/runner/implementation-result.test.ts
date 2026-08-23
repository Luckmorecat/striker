import { describe, expect, it } from "vitest";

import { parseImplementationResult } from "./implementation-result.js";

describe("parseImplementationResult", () => {
  it("accepts one strict implementation result", () => {
    const result = {
      discoveries: [],
      kind: "implementation",
      summary: "Added the command and its public integration test.",
    } as const;

    expect(parseImplementationResult(JSON.stringify(result))).toEqual(result);
  });

  it("rejects prose, code fences, empty summaries, and unknown fields", () => {
    const result = {
      discoveries: [],
      kind: "implementation",
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
          summary: "done",
        }),
      ),
    ).toThrow("one proposal per ledger entry");
  });
});
