import type { ResolvedDiscoveryProposal } from "./discovery-contracts.js";
import type { ResolvedOutcomeFactProposal } from "./outcome-contracts.js";
import type { PlanComplianceReviewResult } from "./review-contracts.js";

function discoveryKey(value: { readonly id: string; readonly kind: string }) {
  return `${value.kind}:${value.id}`;
}

export function validatePlanReviewDecisions(
  result: PlanComplianceReviewResult,
  discoveries: readonly ResolvedDiscoveryProposal[],
  outcomeFacts: readonly ResolvedOutcomeFactProposal[],
): void {
  const expectedDiscoveries = new Set(discoveries.map(discoveryKey));
  const actualDiscoveries = new Set(
    result.discoveryDecisions.map(discoveryKey),
  );
  if (
    result.discoveryDecisions.length !== discoveries.length ||
    expectedDiscoveries.size !== actualDiscoveries.size ||
    [...expectedDiscoveries].some((key) => !actualDiscoveries.has(key))
  ) {
    throw new Error("Plan-compliance decisions do not match discoveries");
  }
  const expectedFacts = new Set(outcomeFacts.map((fact) => fact.id));
  const actualFacts = new Set(
    result.outcomeFactDecisions.map((decision) => decision.id),
  );
  if (
    result.outcomeFactDecisions.length !== outcomeFacts.length ||
    expectedFacts.size !== actualFacts.size ||
    [...expectedFacts].some((id) => !actualFacts.has(id))
  ) {
    throw new Error("Plan-compliance decisions do not match Outcome Facts");
  }
}
