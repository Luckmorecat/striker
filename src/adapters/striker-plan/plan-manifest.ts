import { z } from "zod";

const taskPathPattern =
  /^(?!(?:spine|map|log)\.md$)(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.(?:\/|$))(?!.*\/\/).+\.md$/;

const repositoryPathPattern =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.(?:\/|$))(?!.*\/\/).+$/;
const nonblankTextSchema = z
  .string()
  .min(1)
  .regex(/\S/, "must contain a non-whitespace character");

const codeEvidenceSchema = z
  .object({
    line: z.number().int().positive(),
    path: z.string().min(1).regex(repositoryPathPattern),
  })
  .strict();

const assumptionSchema = z
  .object({
    evidence: z.array(codeEvidenceSchema).min(1),
    statement: nonblankTextSchema,
  })
  .strict();

const defaultSchema = z
  .object({
    reason: nonblankTextSchema,
    reversalCost: nonblankTextSchema,
    statement: nonblankTextSchema,
  })
  .strict();

const relativeTaskPathSchema = z
  .string()
  .min(1)
  .regex(
    taskPathPattern,
    "task paths must name non-reserved Markdown files with normalized relative POSIX paths",
  );

export const planManifestSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    assumptions: z.record(z.string().regex(/^A[1-9]\d*$/), assumptionSchema),
    defaults: z.record(z.string().regex(/^D[1-9]\d*$/), defaultSchema),
    taskSource: z.literal("striker-plan"),
    tasks: z
      .array(relativeTaskPathSchema)
      .min(1)
      .refine((tasks) => new Set(tasks).size === tasks.length, {
        message: "task paths must be unique",
      })
      .meta({ uniqueItems: true }),
    version: z.literal(2),
  })
  .strict()
  .meta({
    title: "Striker plan manifest",
  });

export const planManifestJsonSchema = z.toJSONSchema(planManifestSchema, {
  target: "draft-2020-12",
});

export type PlanManifest = z.infer<typeof planManifestSchema>;
export type PlanAssumption = z.infer<typeof assumptionSchema>;
export type PlanCodeEvidence = z.infer<typeof codeEvidenceSchema>;
export type PlanDefault = z.infer<typeof defaultSchema>;

export function parsePlanManifest(value: unknown): PlanManifest {
  return planManifestSchema.parse(value);
}
