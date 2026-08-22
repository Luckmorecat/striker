import { describe, expect, it } from "vitest";

import { parseReviewResult } from "./review-result.js";

const passed = {
  findings: [],
  kind: "standards",
  resultCommit: "candidate",
  startCommit: "baseline",
  verdict: "passed",
} as const;

describe("parseReviewResult", () => {
  it("accepts one strict standards-review result", () => {
    expect(parseReviewResult(JSON.stringify(passed))).toEqual(passed);
  });

  it("rejects prose or a code fence around the result", () => {
    expect(() =>
      parseReviewResult(`Review complete.\n${JSON.stringify(passed)}`),
    ).toThrow("strict JSON object");
    expect(() =>
      parseReviewResult(`\`\`\`json\n${JSON.stringify(passed)}\n\`\`\``),
    ).toThrow("strict JSON object");
  });

  it("rejects unknown fields and invalid finding locations", () => {
    expect(() =>
      parseReviewResult(JSON.stringify({ ...passed, summary: "clean" })),
    ).toThrow();
    expect(() =>
      parseReviewResult(
        JSON.stringify({
          ...passed,
          findings: [
            {
              fix: "Remove the import.",
              kind: "rule_violation",
              location: { line: 0 },
              message: "Core imports CLI code.",
              path: "src/core/task.ts",
              rule: "Core must not import CLI.",
              severity: "blocking",
            },
          ],
          verdict: "changes_required",
        }),
      ),
    ).toThrow();
  });

  it("requires verdicts to agree with blocking findings", () => {
    const finding = {
      fix: "Split the function.",
      kind: "rule_violation",
      location: { endLine: 100, line: 1 },
      message: "The function exceeds the repository limit.",
      path: "src/core/task.ts",
      rule: "Functions must stay within 80 logical lines.",
      severity: "blocking",
    } as const;
    expect(() =>
      parseReviewResult(
        JSON.stringify({ ...passed, findings: [finding], verdict: "passed" }),
      ),
    ).toThrow("verdict does not match");
    expect(() =>
      parseReviewResult(
        JSON.stringify({ ...passed, verdict: "changes_required" }),
      ),
    ).toThrow("verdict does not match");
  });
});
