import { z } from "zod";

import type { ImplementationResult } from "../core/contracts.js";
import {
  discoveryProposalsSchema,
  outcomeFactProposalsSchema,
} from "../discovery-schema.js";

const implementationResultSchema = z
  .object({
    discoveries: discoveryProposalsSchema,
    kind: z.literal("implementation"),
    outcomeFacts: outcomeFactProposalsSchema,
    summary: z.string().min(1),
  })
  .strict();

export function parseImplementationResult(
  output: string,
): ImplementationResult {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error("Implementor must return one strict JSON object", {
      cause: error,
    });
  }
  return implementationResultSchema.parse(value);
}
