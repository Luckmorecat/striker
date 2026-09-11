import { z } from "zod";
export const cleanupSchema = z.enum(["started", "completed"]);
export const cleanupStartedSchema = z
  .object({ type: z.literal("cleanup_started"), runId: z.string().min(1) })
  .strict();
export const cleanupCompletedSchema = z
  .object({ type: z.literal("cleanup_completed"), runId: z.string().min(1) })
  .strict();
