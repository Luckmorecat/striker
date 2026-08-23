import { z } from "zod";

const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.split("/").some((part) => part === ".." || part.length === 0),
    "Finding path must be a normalized repository-relative path",
  );

const findingSchema = z
  .object({
    fix: z.string().min(1),
    kind: z.enum(["defect", "plan_violation", "rule_violation"]),
    location: z
      .object({
        endLine: z.number().int().positive().optional(),
        line: z.number().int().positive(),
      })
      .strict()
      .refine(
        ({ endLine, line }) => endLine === undefined || endLine >= line,
        "Finding end line must not precede its start line",
      ),
    message: z.string().min(1),
    path: relativePathSchema,
    rule: z.string().min(1),
    severity: z.enum(["advisory", "blocking"]),
  })
  .strict();

const resultFields = {
  findings: z.array(findingSchema),
  resultCommit: z.string().min(1),
  startCommit: z.string().min(1),
  verdict: z.enum(["changes_required", "passed"]),
} as const;

function verdictMatchesFindings(result: {
  readonly findings: readonly { readonly severity: string }[];
  readonly verdict: "changes_required" | "passed";
}): boolean {
  return (
    (result.verdict === "changes_required") ===
    result.findings.some((finding) => finding.severity === "blocking")
  );
}

export const discoveryDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      decision: z.enum(["accepted", "rejected"]),
      id: z.string().regex(/^A[1-9]\d*$/u),
      kind: z.literal("assumption"),
      reason: z.string().min(1).regex(/\S/u),
    })
    .strict(),
  z
    .object({
      decision: z.enum(["accepted", "rejected"]),
      id: z.string().regex(/^D[1-9]\d*$/u),
      kind: z.literal("default"),
      reason: z.string().min(1).regex(/\S/u),
    })
    .strict(),
]);

const discoveryDecisionsSchema = z
  .array(discoveryDecisionSchema)
  .default([])
  .superRefine((decisions, context) => {
    const keys = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
      const key = `${decision.kind}:${decision.id}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Plan review permits one decision per discovery proposal",
          path: [index],
        });
      }
      keys.add(key);
    }
  });

export const standardsReviewResultSchema = z
  .object({ ...resultFields, kind: z.literal("standards") })
  .strict()
  .refine(
    verdictMatchesFindings,
    "Review verdict does not match its blocking findings",
  )
  .refine(
    ({ findings }) =>
      findings.every(
        (finding) =>
          finding.kind === "defect" || finding.kind === "rule_violation",
      ),
    "Review finding kind does not match its review kind",
  );

export const planComplianceReviewResultSchema = z
  .object({
    ...resultFields,
    discoveryDecisions: discoveryDecisionsSchema,
    kind: z.literal("plan_compliance"),
  })
  .strict()
  .refine(
    verdictMatchesFindings,
    "Review verdict does not match its blocking findings",
  )
  .refine(
    ({ findings }) =>
      findings.every(
        (finding) =>
          finding.kind === "defect" || finding.kind === "plan_violation",
      ),
    "Review finding kind does not match its review kind",
  );

export const reviewResultSchema = z.union([
  standardsReviewResultSchema,
  planComplianceReviewResultSchema,
]);
