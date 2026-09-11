import { z } from "zod";

export const executionDescriptorSchema = z
  .object({
    backend: z.literal("docker"),
    recoveryId: z.string().regex(/^[a-f0-9]{64}$/),
    environmentId: z.string().regex(/^[a-f0-9]{64}$/),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sourceRoot: z.string().min(1),
    sourceHead: z.string().regex(/^[a-f0-9]{40,64}$/),
    sourceBranch: z.string().min(1),
  })
  .strict()
  .optional();
