import { z } from "zod";
import { deliveredOutcomeSchema } from "./run-journal-outcome-schema.js";
export const agentSessionSchema = z
  .object({
    id: z.string().min(1),
    resumeId: z.string().min(1).optional(),
    execution: z
      .object({
        environmentId: z.string().regex(/^[a-f0-9]{64}$/),
        stageId: z.uuid(),
        inputId: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export const agentRequestSchema = z
  .object({
    instructions: z.string(),
    priorTaskEvidence: z.array(deliveredOutcomeSchema).optional(),
    skills: z.array(z.string()),
    workflowInstructions: z.string().optional(),
  })
  .strict();
