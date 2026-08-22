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
    kind: z.enum(["defect", "rule_violation"]),
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

export const reviewResultSchema = z
  .object({
    findings: z.array(findingSchema),
    kind: z.literal("standards"),
    resultCommit: z.string().min(1),
    startCommit: z.string().min(1),
    verdict: z.enum(["changes_required", "passed"]),
  })
  .strict()
  .refine(
    ({ findings, verdict }) =>
      (verdict === "changes_required") ===
      findings.some((finding) => finding.severity === "blocking"),
    "Review verdict does not match its blocking findings",
  );
