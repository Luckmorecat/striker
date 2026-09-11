import { z } from "zod";
const head = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const applicationSchema = z
  .object({ head, status: z.enum(["started", "completed"]) })
  .strict();
export const applicationStartedSchema = z
  .object({
    type: z.literal("application_started"),
    runId: z.string().min(1),
    head,
  })
  .strict();
export const applicationCompletedSchema = z
  .object({
    type: z.literal("application_completed"),
    runId: z.string().min(1),
    head,
  })
  .strict();
