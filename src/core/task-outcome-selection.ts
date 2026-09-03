import type { GitRepository } from "./contracts.js";
import type { TaskIdentity } from "./execution-contracts.js";
import {
  outcomeProtocolLimits,
  type DeliveredOutcomeFact,
  type DeliveredOutcomeTransition,
  type DeliveredTaskOutcome,
  type OutcomeRoute,
  type TaskOutcome,
} from "./outcome-contracts.js";

interface SelectionRequest {
  readonly execution: { readonly head: string; readonly root: string };
  readonly git: GitRepository;
  readonly journalPlanId: string;
  readonly outcomes: readonly TaskOutcome[];
  readonly planId: string;
  readonly routes: readonly OutcomeRoute[];
  readonly taskPlanId: string;
  readonly target: TaskIdentity;
  readonly taskOrder: readonly TaskIdentity[];
}

export type TaskOutcomeSelectionResult =
  | {
      readonly evidence: readonly DeliveredTaskOutcome[];
      readonly status: "selected";
    }
  | { readonly detail: string; readonly status: "conflict" }
  | { readonly detail: string; readonly status: "limit_exceeded" };

export function serializeDeliveredTaskOutcomes(
  evidence: readonly DeliveredTaskOutcome[],
): string {
  return JSON.stringify(evidence);
}

function sameIdentity(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function identityKey(identity: TaskIdentity): string {
  return `${identity.id}\u0000${identity.revision}`;
}

function exactIndex(
  order: readonly TaskIdentity[],
  identity: TaskIdentity,
): number {
  const indexes = order.flatMap((candidate, index) =>
    sameIdentity(candidate, identity) ? [index] : [],
  );
  return indexes.length === 1 && indexes[0] !== undefined ? indexes[0] : -1;
}

function entryOrder(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  const leftDigits = left.id.slice(1);
  const rightDigits = right.id.slice(1);
  const lengthDifference = leftDigits.length - rightDigits.length;
  if (lengthDifference !== 0) return lengthDifference;
  const numericOrder = leftDigits.localeCompare(rightDigits);
  return numericOrder === 0 ? left.id.localeCompare(right.id) : numericOrder;
}

function sourceRoute(
  routes: readonly OutcomeRoute[],
  source: TaskIdentity,
): readonly TaskIdentity[] | null {
  const sourceRoutes = routes.filter((route) =>
    sameIdentity(route.from, source),
  );
  return sourceRoutes.length === 1 && sourceRoutes[0] !== undefined
    ? sourceRoutes[0].to
    : null;
}

function routeAllows(
  route: readonly TaskIdentity[] | null,
  target: TaskIdentity,
): boolean {
  return (
    route?.filter((candidate) => sameIdentity(candidate, target)).length === 1
  );
}

function completeRoute(
  route: readonly TaskIdentity[] | null,
  relevantTo: readonly TaskIdentity[],
): boolean {
  return (
    route !== null &&
    route.length === relevantTo.length &&
    route.every((target) => routeAllows(relevantTo, target))
  );
}

function targetConflict(
  request: SelectionRequest,
  outcome: TaskOutcome,
  sourceIndex: number,
  target: TaskIdentity,
  route: readonly TaskIdentity[] | null,
): string | null {
  const routedIndex = exactIndex(request.taskOrder, target);
  if (routedIndex <= sourceIndex) {
    return `Task Outcome route identity conflicts: ${outcome.source.id} -> ${target.id}`;
  }
  return routeAllows(route, target)
    ? null
    : `Task Outcome route is not authorized: ${outcome.source.id} -> ${target.id}`;
}

function relationshipConflict(
  request: SelectionRequest,
  outcome: TaskOutcome,
  targetIndex: number,
): string | null {
  const sourceIndex = exactIndex(request.taskOrder, outcome.source);
  if (sourceIndex < 0 || sourceIndex >= targetIndex) {
    return `Task Outcome source identity conflicts with the target: ${outcome.source.id}`;
  }
  const route = sourceRoute(request.routes, outcome.source);
  for (const entry of outcome.facts) {
    for (const target of entry.relevantTo) {
      const conflict = targetConflict(
        request,
        outcome,
        sourceIndex,
        target,
        route,
      );
      if (conflict !== null) return conflict;
    }
  }
  for (const transition of outcome.transitions) {
    if (!completeRoute(route, transition.relevantTo)) {
      return `Task Outcome transition route is incomplete: ${outcome.source.id} -> ${transition.id}`;
    }
    for (const target of transition.relevantTo) {
      const conflict = targetConflict(
        request,
        outcome,
        sourceIndex,
        target,
        route,
      );
      if (conflict !== null) return conflict;
    }
  }
  return null;
}

function isRelevant(
  relevantTo: readonly TaskIdentity[],
  target: TaskIdentity,
): boolean {
  return relevantTo.some((candidate) => sameIdentity(candidate, target));
}

function deliverFact(fact: TaskOutcome["facts"][number]): DeliveredOutcomeFact {
  return {
    category: fact.category,
    evidence: fact.evidence,
    id: fact.id,
    statement: fact.statement,
  };
}

function deliverTransition(
  transition: TaskOutcome["transitions"][number],
): DeliveredOutcomeTransition {
  return {
    id: transition.id,
    kind: transition.kind,
    state: transition.state,
  };
}

function unseenEntries<T extends { readonly id: string }>(
  entries: readonly T[],
  existingIds: Set<string>,
): readonly T[] {
  return entries.filter((entry) => {
    if (existingIds.has(entry.id)) return false;
    existingIds.add(entry.id);
    return true;
  });
}

function sameMetadata(
  left: DeliveredTaskOutcome,
  right: DeliveredTaskOutcome,
): boolean {
  return (
    left.resultCommit === right.resultCommit &&
    JSON.stringify(left.changedPaths) === JSON.stringify(right.changedPaths) &&
    JSON.stringify(left.verification) === JSON.stringify(right.verification)
  );
}

function mergeEntries(
  current: DeliveredTaskOutcome,
  candidate: DeliveredTaskOutcome,
): DeliveredTaskOutcome {
  const existingIds = new Set(
    [...current.facts, ...current.transitions].map((entry) => entry.id),
  );
  const facts = unseenEntries(candidate.facts, existingIds);
  const transitions = unseenEntries(candidate.transitions, existingIds);
  return {
    ...current,
    facts: [...current.facts, ...facts],
    transitions: [...current.transitions, ...transitions],
  };
}

function mergeOutcome(
  deliveries: Map<string, DeliveredTaskOutcome>,
  outcome: TaskOutcome,
  target: TaskIdentity,
): string | null {
  const facts = outcome.facts
    .filter((fact) => isRelevant(fact.relevantTo, target))
    .map(deliverFact);
  const transitions = outcome.transitions
    .filter((transition) => isRelevant(transition.relevantTo, target))
    .map(deliverTransition);
  if (facts.length === 0 && transitions.length === 0) return null;
  const key = identityKey(outcome.source);
  const current = deliveries.get(key);
  const candidate: DeliveredTaskOutcome = {
    changedPaths: outcome.changedPaths,
    facts,
    resultCommit: outcome.resultCommit,
    source: outcome.source,
    transitions,
    verification: outcome.verification,
  };
  if (current === undefined) {
    deliveries.set(key, candidate);
    return null;
  }
  if (!sameMetadata(current, candidate)) {
    return `Duplicate Task Outcome metadata conflicts: ${outcome.source.id}`;
  }
  deliveries.set(key, mergeEntries(current, candidate));
  return null;
}

function requestConflict(request: SelectionRequest): string | null {
  if (
    request.planId !== request.journalPlanId ||
    request.planId !== request.taskPlanId
  ) {
    return "Task Outcome plan identity conflicts";
  }
  return exactIndex(request.taskOrder, request.target) < 0
    ? "Task Outcome target identity conflicts"
    : null;
}

async function collectDeliveries(
  request: SelectionRequest,
): Promise<
  | { readonly deliveries: ReadonlyMap<string, DeliveredTaskOutcome> }
  | { readonly detail: string }
> {
  const isAncestor = request.git.isAncestor?.bind(request.git);
  if (isAncestor === undefined) {
    return { detail: "Task Outcome ancestry validation is unavailable" };
  }
  const targetIndex = exactIndex(request.taskOrder, request.target);
  const deliveries = new Map<string, DeliveredTaskOutcome>();
  for (const outcome of request.outcomes) {
    const conflict = relationshipConflict(request, outcome, targetIndex);
    if (conflict !== null) return { detail: conflict };
    const ancestor = await isAncestor(
      request.execution.root,
      outcome.resultCommit,
      request.execution.head,
    );
    if (!ancestor) {
      return {
        detail: `Task Outcome result commit is not an execution ancestor: ${outcome.resultCommit}`,
      };
    }
    const duplicateConflict = mergeOutcome(deliveries, outcome, request.target);
    if (duplicateConflict !== null) return { detail: duplicateConflict };
  }
  return { deliveries };
}

function orderedEvidence(
  deliveries: ReadonlyMap<string, DeliveredTaskOutcome>,
  order: readonly TaskIdentity[],
): readonly DeliveredTaskOutcome[] {
  return [...deliveries.values()]
    .sort(
      (left, right) =>
        exactIndex(order, left.source) - exactIndex(order, right.source),
    )
    .map((delivery) => ({
      ...delivery,
      facts: [...delivery.facts].sort(entryOrder),
      transitions: [...delivery.transitions].sort(entryOrder),
    }));
}

export async function selectTaskOutcomeEvidence(
  request: SelectionRequest,
): Promise<TaskOutcomeSelectionResult> {
  const conflict = requestConflict(request);
  if (conflict !== null) return { detail: conflict, status: "conflict" };
  if (request.outcomes.length === 0)
    return { evidence: [], status: "selected" };
  const collected = await collectDeliveries(request);
  if ("detail" in collected) {
    return { detail: collected.detail, status: "conflict" };
  }
  const evidence = orderedEvidence(collected.deliveries, request.taskOrder);
  const factCount = evidence.reduce(
    (count, item) => count + item.facts.length,
    0,
  );
  const byteCount = new TextEncoder().encode(
    serializeDeliveredTaskOutcomes(evidence),
  ).byteLength;
  if (
    factCount > outcomeProtocolLimits.selectedFactsPerTarget ||
    byteCount > outcomeProtocolLimits.serializedEvidenceBytesPerRequest
  ) {
    return {
      detail: `Task Outcome delivery exceeds protocol limits (${String(factCount)} facts, ${String(byteCount)} bytes)`,
      status: "limit_exceeded",
    };
  }
  return { evidence, status: "selected" };
}
