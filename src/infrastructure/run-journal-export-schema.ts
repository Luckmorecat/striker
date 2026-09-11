import { z } from "zod";
import { taskIdentitySchema } from "./run-journal-common-schema.js";
const head = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const resultExportSchema = z
  .object({
    branch: z.string().regex(/^codex\/striker-[A-Za-z0-9][A-Za-z0-9-]*$/),
    head: head.nullable(),
    error: z.string().nullable(),
    pending: z
      .object({
        task: taskIdentitySchema,
        startCommit: head,
        resultCommit: head,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const resultExportCompletedSchema = z
  .object({
    type: z.literal("result_export_completed"),
    runId: z.string().min(1),
    head,
  })
  .strict();
export const resultExportFailedSchema = z
  .object({
    type: z.literal("result_export_failed"),
    runId: z.string().min(1),
    head,
    error: z.string().min(1),
  })
  .strict();
