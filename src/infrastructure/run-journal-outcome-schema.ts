import { z } from "zod";

import { outcomeFactCategories } from "../core/outcome-contracts.js";
import { resolvedOutcomeLocatorSchema } from "../discovery-schema.js";
import {
  taskIdentitySchema,
  verificationSchema,
} from "./run-journal-common-schema.js";

const deliveredFactSchema = z
  .object({
    category: z.enum(outcomeFactCategories),
    evidence: resolvedOutcomeLocatorSchema,
    id: z.string(),
    statement: z.string(),
  })
  .strict();

const deliveredTransitionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string(),
      kind: z.literal("assumption"),
      state: z.enum(["confirmed", "disproved", "needs_decision"]),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("default"),
      state: z.literal("deviated"),
    })
    .strict(),
]);

export const deliveredOutcomeSchema = z
  .object({
    changedPaths: z.array(z.string()),
    facts: z.array(deliveredFactSchema),
    resultCommit: z.string().min(1),
    source: taskIdentitySchema,
    transitions: z.array(deliveredTransitionSchema),
    verification: verificationSchema.omit({ output: true }),
  })
  .strict();
