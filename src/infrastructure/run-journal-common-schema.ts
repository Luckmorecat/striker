import { z } from "zod";

export const taskIdentitySchema = z
  .object({ id: z.string().min(1), revision: z.string().min(1) })
  .strict();

export const verificationSchema = z
  .object({
    command: z.string(),
    exitCode: z.number().int(),
    output: z.string(),
  })
  .strict();
