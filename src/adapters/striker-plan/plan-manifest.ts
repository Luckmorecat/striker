import { z } from "zod";

import { planTaskPathPattern } from "../../core/outcome-contracts.js";

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
    planTaskPathPattern,
    "task paths must name non-reserved Markdown files with normalized relative POSIX paths",
  );

const outcomeRouteSchema = z
  .object({
    from: relativeTaskPathSchema,
    to: z
      .array(relativeTaskPathSchema)
      .min(1)
      .refine((targets) => new Set(targets).size === targets.length, {
        message: "outcome route targets must be unique",
      })
      .meta({ uniqueItems: true }),
  })
  .strict();

export const planManifestSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    assumptions: z.record(z.string().regex(/^A[1-9]\d*$/), assumptionSchema),
    defaults: z.record(z.string().regex(/^D[1-9]\d*$/), defaultSchema),
    outcomeRoutes: z.array(outcomeRouteSchema),
    taskSource: z.literal("striker-plan"),
    tasks: z
      .array(relativeTaskPathSchema)
      .min(1)
      .refine((tasks) => new Set(tasks).size === tasks.length, {
        message: "task paths must be unique",
      })
      .meta({ uniqueItems: true }),
    version: z.literal(3),
  })
  .strict()
  .superRefine((manifest, context) => {
    const positions = new Map(
      manifest.tasks.map((taskPath, index) => [taskPath, index]),
    );
    const sources = new Set<string>();
    for (const [index, route] of manifest.outcomeRoutes.entries()) {
      const sourceIndex = positions.get(route.from);
      if (sources.has(route.from)) {
        context.addIssue({
          code: "custom",
          message: "outcome route sources must be unique",
          path: ["outcomeRoutes", index, "from"],
        });
      }
      sources.add(route.from);
      if (sourceIndex === undefined) {
        context.addIssue({
          code: "custom",
          message: "outcome route source must name a declared task",
          path: ["outcomeRoutes", index, "from"],
        });
      }
      for (const [targetIndex, target] of route.to.entries()) {
        const position = positions.get(target);
        if (position === undefined) {
          context.addIssue({
            code: "custom",
            message: "outcome route target must name a declared task",
            path: ["outcomeRoutes", index, "to", targetIndex],
          });
        } else if (sourceIndex !== undefined && position <= sourceIndex) {
          context.addIssue({
            code: "custom",
            message: "outcome routes must point strictly forward",
            path: ["outcomeRoutes", index, "to", targetIndex],
          });
        }
      }
    }
  })
  .meta({
    title: "Striker plan manifest",
  });

export const planManifestJsonSchema = z.toJSONSchema(planManifestSchema, {
  target: "draft-2020-12",
});

export type PlanManifest = z.infer<typeof planManifestSchema>;
export type PlanOutcomeRoute = z.infer<typeof outcomeRouteSchema>;
export type PlanAssumption = z.infer<typeof assumptionSchema>;
export type PlanCodeEvidence = z.infer<typeof codeEvidenceSchema>;
export type PlanDefault = z.infer<typeof defaultSchema>;

export function parsePlanManifest(value: unknown): PlanManifest {
  return planManifestSchema.parse(value);
}
