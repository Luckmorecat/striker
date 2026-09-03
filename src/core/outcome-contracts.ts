import type {
  CodeDiscoveryLocator,
  DiscoveryLocator,
  VerificationDiscoveryLocator,
} from "./discovery-contracts.js";
import type { TaskIdentity } from "./execution-contracts.js";
import {
  resolveDiscoveryLocator,
  type DiscoveryEvidenceRepository,
  type DiscoveryExecutionEvidence,
} from "./discovery-proposal.js";

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

export type ResolvedOutcomeFactProposal = Omit<
  OutcomeFactProposal,
  "evidence"
> & {
  readonly evidence:
    | (CodeDiscoveryLocator & { readonly commit: string })
    | VerificationDiscoveryLocator;
};

export interface OutcomeTarget {
  readonly contract: string;
  readonly identity: TaskIdentity;
}

export interface OutcomeRoute {
  readonly from: TaskIdentity;
  readonly to: readonly TaskIdentity[];
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
}

function isRepositoryPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").some((part) => part === ".." || part.length === 0)
  );
}

function invalidEvidence(factId: string): never {
  throw new Error(`Invalid Outcome Fact evidence: ${factId}`);
}

function validateCodeEvidence(
  value: object,
  factId: string,
): CodeDiscoveryLocator {
  const evidence = value as Partial<CodeDiscoveryLocator>;
  if (!hasExactKeys(value, ["kind", "line", "path", "text"])) {
    return invalidEvidence(factId);
  }
  if (!Number.isInteger(evidence.line) || (evidence.line ?? 0) <= 0) {
    return invalidEvidence(factId);
  }
  if (
    typeof evidence.path !== "string" ||
    !isRepositoryPath(evidence.path) ||
    typeof evidence.text !== "string"
  ) {
    return invalidEvidence(factId);
  }
  return evidence as CodeDiscoveryLocator;
}

function validateVerificationEvidence(
  value: object,
  factId: string,
): VerificationDiscoveryLocator {
  const evidence = value as Partial<VerificationDiscoveryLocator>;
  if (!hasExactKeys(value, ["command", "exitCode", "kind", "output"])) {
    return invalidEvidence(factId);
  }
  if (
    typeof evidence.command !== "string" ||
    evidence.command.trim().length === 0 ||
    !Number.isInteger(evidence.exitCode) ||
    typeof evidence.output !== "string"
  ) {
    return invalidEvidence(factId);
  }
  return evidence as VerificationDiscoveryLocator;
}

function validateEvidence(value: unknown, factId: string): DiscoveryLocator {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return invalidEvidence(factId);
  }
  if (value.kind === "code") return validateCodeEvidence(value, factId);
  if (value.kind === "verification") {
    return validateVerificationEvidence(value, factId);
  }
  return invalidEvidence(factId);
}

function validateFactIdentity(fact: OutcomeFactProposal): void {
  if (typeof fact.id !== "string" || !/^F[1-9]\d*$/u.test(fact.id)) {
    throw new Error(`Invalid Outcome Fact ID: ${fact.id}`);
  }
  if (!outcomeFactCategories.includes(fact.category)) {
    throw new Error(`Invalid Outcome Fact category: ${fact.category}`);
  }
}

function validateStatement(fact: OutcomeFactProposal): void {
  if (
    typeof fact.statement !== "string" ||
    fact.statement.trim().length === 0 ||
    fact.statement.length > outcomeProtocolLimits.statementCharacters
  ) {
    throw new Error(`Invalid Outcome Fact statement: ${fact.id}`);
  }
}

function validateExcerpt(evidence: DiscoveryLocator, factId: string): void {
  const excerpt = evidence.kind === "code" ? evidence.text : evidence.output;
  if (
    excerpt.trim().length === 0 ||
    excerpt.length > outcomeProtocolLimits.evidenceExcerptCharacters
  ) {
    invalidEvidence(factId);
  }
}

function validateRelevantTargets(fact: OutcomeFactProposal): void {
  if (
    !Array.isArray(fact.relevantTo) ||
    fact.relevantTo.length === 0 ||
    fact.relevantTo.length > outcomeProtocolLimits.targetsPerFact ||
    new Set(fact.relevantTo).size !== fact.relevantTo.length
  ) {
    throw new Error(`Invalid Outcome Fact targets: ${fact.id}`);
  }
  if (
    fact.relevantTo.some(
      (target) =>
        typeof target !== "string" || !planTaskPathPattern.test(target),
    )
  ) {
    throw new Error(`Invalid Outcome Fact targets: ${fact.id}`);
  }
}

function validateFactShape(fact: OutcomeFactProposal): void {
  if (
    !hasExactKeys(fact, [
      "category",
      "evidence",
      "id",
      "relevantTo",
      "statement",
    ])
  ) {
    throw new Error("Malformed Outcome Fact");
  }
  validateFactIdentity(fact);
  const evidence = validateEvidence(fact.evidence, fact.id);
  validateStatement(fact);
  validateExcerpt(evidence, fact.id);
  validateRelevantTargets(fact);
}

interface OutcomeValidationTask {
  readonly identity: TaskIdentity;
  readonly outcomeRoutes?: readonly TaskIdentity[];
  readonly outcomeTaskOrder?: readonly TaskIdentity[];
  readonly outcomeTargets?: readonly OutcomeTarget[];
}

function taskOrder(task: OutcomeValidationTask): {
  readonly sourceIndex: number;
  readonly tasks: readonly TaskIdentity[];
} {
  const orderedTasks = task.outcomeTaskOrder ?? [];
  const sourceIndex = orderedTasks.findIndex(
    (candidate) =>
      candidate.id === task.identity.id &&
      candidate.revision === task.identity.revision,
  );
  if (sourceIndex === -1) {
    throw new Error("Outcome Fact task order is unavailable");
  }
  return { sourceIndex, tasks: orderedTasks };
}

function targetOrderIndex(
  tasks: readonly TaskIdentity[],
  targetId: string,
): number {
  const indexes = tasks.flatMap((candidate, index) =>
    candidate.id === targetId ? [index] : [],
  );
  if (indexes.length === 0) {
    throw new Error(`Unknown Outcome Fact target: ${targetId}`);
  }
  if (indexes.length !== 1 || indexes[0] === undefined) {
    throw new Error(`Outcome Fact task order is invalid: ${targetId}`);
  }
  return indexes[0];
}

function outcomeRoute(
  task: OutcomeValidationTask,
  targetId: string,
): TaskIdentity {
  const routes =
    task.outcomeRoutes?.filter((target) => target.id === targetId) ?? [];
  if (routes.length !== 1 || routes[0] === undefined) {
    throw new Error(
      `Outcome Fact target is outside the source route: ${targetId}`,
    );
  }
  return routes[0];
}

function requireTargetContract(
  task: OutcomeValidationTask,
  route: TaskIdentity,
): void {
  const targets =
    task.outcomeTargets?.filter(
      (candidate) =>
        candidate.identity.id === route.id &&
        candidate.identity.revision === route.revision,
    ) ?? [];
  if (
    targets.length !== 1 ||
    targets[0] === undefined ||
    targets[0].contract.trim().length === 0
  ) {
    throw new Error(`Outcome Fact target contract is unavailable: ${route.id}`);
  }
}

function validateFactTargets(
  fact: OutcomeFactProposal,
  task: OutcomeValidationTask,
): void {
  const order = taskOrder(task);
  for (const targetId of fact.relevantTo) {
    const targetIndex = targetOrderIndex(order.tasks, targetId);
    if (targetIndex <= order.sourceIndex) {
      throw new Error(`Outcome Fact target is backward: ${targetId}`);
    }
    const route = outcomeRoute(task, targetId);
    if (order.tasks[targetIndex]?.revision !== route.revision) {
      throw new Error(`Outcome Fact target identity conflicts: ${targetId}`);
    }
    requireTargetContract(task, route);
  }
}

export function validateOutcomeFactShapes(
  facts: readonly OutcomeFactProposal[],
): void {
  if (facts.length > outcomeProtocolLimits.factsPerSourceTask) {
    throw new Error("Outcome Fact limit exceeded");
  }
  const ids = new Set<string>();
  for (const fact of facts) {
    validateFactShape(fact);
    if (ids.has(fact.id))
      throw new Error(`Duplicate Outcome Fact ID: ${fact.id}`);
    ids.add(fact.id);
  }
}

export function validateResolvedOutcomeFactShapes(
  facts: readonly ResolvedOutcomeFactProposal[],
): void {
  const unresolved = facts.map((fact): OutcomeFactProposal => {
    if (fact.evidence.kind !== "code") return fact;
    const evidence = {
      kind: fact.evidence.kind,
      line: fact.evidence.line,
      path: fact.evidence.path,
      text: fact.evidence.text,
    };
    return { ...fact, evidence };
  });
  validateOutcomeFactShapes(unresolved);
}

export function validateOutcomeFactProposals(
  facts: readonly OutcomeFactProposal[],
  task: OutcomeValidationTask,
): void {
  validateOutcomeFactShapes(facts);
  for (const fact of facts) validateFactTargets(fact, task);
}

export async function resolveOutcomeFactProposals(
  facts: readonly OutcomeFactProposal[],
  task: OutcomeValidationTask,
  execution: DiscoveryExecutionEvidence,
  git: DiscoveryEvidenceRepository | undefined,
): Promise<readonly ResolvedOutcomeFactProposal[]> {
  validateOutcomeFactProposals(facts, task);
  return Promise.all(
    facts.map(async (fact) => ({
      ...fact,
      evidence: await resolveDiscoveryLocator(fact.evidence, execution, git),
    })),
  );
}
