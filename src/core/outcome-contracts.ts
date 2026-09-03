import type { DiscoveryLocator } from "./discovery-contracts.js";
import type { TaskIdentity } from "./execution-contracts.js";

export const planTaskPathPattern =
  /^(?!(?:spine|map|log)\.md$)(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.(?:\/|$))(?!.*\/\/).+\.md$/u;

export const outcomeFactCategories = [
  "public_contract",
  "compatibility_constraint",
  "verified_default",
  "integration_boundary",
] as const;

export const outcomeProtocolLimits = {
  evidenceExcerptCharacters: 1_000,
  factsPerSourceTask: 8,
  selectedFactsPerTarget: 16,
  serializedEvidenceBytesPerRequest: 16 * 1_024,
  statementCharacters: 500,
  targetsPerFact: 8,
} as const;

export type OutcomeFactCategory = (typeof outcomeFactCategories)[number];

export interface OutcomeFactProposal {
  readonly category: OutcomeFactCategory;
  readonly evidence: DiscoveryLocator;
  readonly id: string;
  readonly relevantTo: readonly string[];
  readonly statement: string;
}

export interface OutcomeRoute {
  readonly from: TaskIdentity;
  readonly to: readonly TaskIdentity[];
}
