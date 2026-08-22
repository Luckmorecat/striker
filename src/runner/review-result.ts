import type { ReviewResult } from "../core/contracts.js";
import { reviewResultSchema } from "../review-result-schema.js";

export function parseReviewResult(output: string): ReviewResult {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error("Reviewer must return one strict JSON object", {
      cause: error,
    });
  }
  const parsed = reviewResultSchema.parse(value);
  return {
    ...parsed,
    findings: parsed.findings.map((finding) => ({
      ...finding,
      location: {
        line: finding.location.line,
        ...(finding.location.endLine === undefined
          ? {}
          : { endLine: finding.location.endLine }),
      },
    })),
  };
}
