import { z } from "zod";

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

export const resolvedDiscoveryProposalSchema = z.union([
  assumptionProposalSchema.extend({ locator: resolvedLocatorSchema }),
  defaultProposalSchema.extend({ locator: resolvedLocatorSchema }),
]);

export const resolvedDiscoveryProposalsSchema = z.array(
  resolvedDiscoveryProposalSchema,
);
