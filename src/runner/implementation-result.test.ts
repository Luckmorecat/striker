import { describe, expect, it } from "vitest";

import { parseImplementationResult } from "./implementation-result.js";

describe("parseImplementationResult", () => {
  it("accepts one strict implementation result", () => {
    const result = {
      kind: "implementation",
      summary: "Added the command and its public integration test.",
    } as const;

    expect(parseImplementationResult(JSON.stringify(result))).toEqual(result);
  });

  it("rejects prose, code fences, empty summaries, and unknown fields", () => {
    const result = { kind: "implementation", summary: "Task complete." };

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
