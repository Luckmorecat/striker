import { z } from "zod";
export const runCompletedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_completed") })
  .strict();
export const runDiscardedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_discarded") })
  .strict();

import { taskIdentitySchema } from "./run-journal-common-schema.js";
export const runSourceChangedSchema = z
  .object({
    current: taskIdentitySchema.nullable(),
    runId: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("run_source_changed"),
  })
  .strict();
