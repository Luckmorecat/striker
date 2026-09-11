import { z } from "zod";
export const runCompletedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_completed") })
  .strict();
export const runDiscardedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_discarded") })
  .strict();
