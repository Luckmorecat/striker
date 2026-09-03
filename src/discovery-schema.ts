import { z } from "zod";

import {
  outcomeFactCategories,
  validateResolvedOutcomeFactShapes,
  validateOutcomeFactShapes,
} from "./core/outcome-contracts.js";

const nonblankText = z.string().min(1).regex(/\S/u);
const repositoryPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.split("/").some((part) => part === ".." || part.length === 0),
    "Discovery path must be a normalized repository-relative path",
  );

const codeLocatorSchema = z
  .object({
    kind: z.literal("code"),
    line: z.number().int().positive(),
    path: repositoryPath,
    text: nonblankText,
  })
  .strict();

const verificationLocatorSchema = z
  .object({
    command: nonblankText,
    exitCode: z.number().int(),
    kind: z.literal("verification"),
    output: nonblankText,
  })
  .strict();

export const discoveryLocatorSchema = z.discriminatedUnion("kind", [
  codeLocatorSchema,
  verificationLocatorSchema,
]);

const outcomeCodeEvidenceSchema = codeLocatorSchema;
const outcomeVerificationEvidenceSchema = verificationLocatorSchema;
const outcomeFactSchema = z
  .object({
    category: z.enum(outcomeFactCategories),
    evidence: z.discriminatedUnion("kind", [
      outcomeCodeEvidenceSchema,
      outcomeVerificationEvidenceSchema,
    ]),
    id: z.string(),
    relevantTo: z.array(z.string()),
    statement: z.string(),
  })
  .strict();

export const outcomeFactProposalsSchema = z
  .array(outcomeFactSchema)
  .superRefine((facts, context) => {
    try {
      validateOutcomeFactShapes(facts);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

const assumptionProposalSchema = z
  .object({
    id: z.string().regex(/^A[1-9]\d*$/u),
    kind: z.literal("assumption"),
    locator: discoveryLocatorSchema,
    reason: nonblankText,
    state: z.enum(["confirmed", "disproved", "needs_decision"]),
  })
  .strict();

const defaultProposalSchema = z
  .object({
    deviation: nonblankText,
    id: z.string().regex(/^D[1-9]\d*$/u),
    kind: z.literal("default"),
    locator: discoveryLocatorSchema,
  })
  .strict();

export const discoveryProposalSchema = z.discriminatedUnion("kind", [
  assumptionProposalSchema,
  defaultProposalSchema,
]);

export const discoveryProposalsSchema = z
  .array(discoveryProposalSchema)
  .superRefine((proposals, context) => {
    const keys = new Set<string>();
    for (const [index, proposal] of proposals.entries()) {
      const key = `${proposal.kind}:${proposal.id}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message:
            "Implementation result permits one proposal per ledger entry",
          path: [index],
        });
      }
      keys.add(key);
    }
  });

const resolvedCodeLocatorSchema = codeLocatorSchema.extend({
  commit: nonblankText,
});

const resolvedLocatorSchema = z.union([
  resolvedCodeLocatorSchema,
  verificationLocatorSchema,
]);

const resolvedOutcomeLocatorSchema = z.union([
  outcomeCodeEvidenceSchema.extend({ commit: nonblankText }),
  outcomeVerificationEvidenceSchema,
]);

export const resolvedOutcomeFactProposalsSchema = z
  .array(outcomeFactSchema.extend({ evidence: resolvedOutcomeLocatorSchema }))
  .superRefine((facts, context) => {
    try {
      validateResolvedOutcomeFactShapes(facts);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

export const resolvedDiscoveryProposalSchema = z.union([
  assumptionProposalSchema.extend({ locator: resolvedLocatorSchema }),
  defaultProposalSchema.extend({ locator: resolvedLocatorSchema }),
]);

export const resolvedDiscoveryProposalsSchema = z.array(
  resolvedDiscoveryProposalSchema,
);
