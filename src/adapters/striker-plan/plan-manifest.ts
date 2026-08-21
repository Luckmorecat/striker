import { z } from "zod";

const taskPathPattern =
  /^(?!(?:spine|map|log)\.md$)(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.(?:\/|$))(?!.*\/\/).+\.md$/;

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
    taskSource: z.literal("striker-plan"),
    tasks: z
      .array(relativeTaskPathSchema)
      .min(1)
      .refine((tasks) => new Set(tasks).size === tasks.length, {
        message: "task paths must be unique",
      })
      .meta({ uniqueItems: true }),
    version: z.literal(1),
  })
  .strict()
  .meta({
    $id: "https://kisshot.dev/striker/plan.schema.json",
    title: "Striker plan manifest",
  });

export const planManifestJsonSchema = z.toJSONSchema(planManifestSchema, {
  target: "draft-2020-12",
});

export type PlanManifest = z.infer<typeof planManifestSchema>;

export function parsePlanManifest(value: unknown): PlanManifest {
  return planManifestSchema.parse(value);
}
