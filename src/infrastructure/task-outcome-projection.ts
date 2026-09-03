import type {
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "../core/contracts.js";
import type {
  CertifiedOutcomeFact,
  ResolvedOutcomeFactProposal,
  TaskOutcome,
  TaskOutcomeTransition,
} from "../core/outcome-contracts.js";
import { matchesIndependentCompletion } from "./run-journal-completion.js";
import { hasAcceptedLedgerEvidence } from "./run-journal-ledger-replay.js";

type Completion = Extract<RunJournalEvent, { type: "task_completed" }>;
type TransitionEvent = Extract<
  RunJournalEvent,
  { type: "ledger_transition_recorded" }
>;

export interface ProjectedTaskOutcome {
  readonly outcome: TaskOutcome;
  readonly sourceIndex: number;
}

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function numericId(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  const numeric = Number(left.id.slice(1)) - Number(right.id.slice(1));
  return numeric === 0 ? left.id.localeCompare(right.id) : numeric;
}

function resolveFact(
  fact: ResolvedOutcomeFactProposal,
  routes: readonly TaskIdentity[],
): CertifiedOutcomeFact | null {
  const relevantTo = fact.relevantTo.map((id) =>
    routes.find((target) => target.id === id),
  );
  if (relevantTo.some((target) => target === undefined)) return null;
  return { ...fact, relevantTo: relevantTo as readonly TaskIdentity[] };
}

function acceptedFacts(
  snapshot: RunSnapshot,
  routes: readonly TaskIdentity[],
): readonly CertifiedOutcomeFact[] | null {
  const review = snapshot.planComplianceReview;
  if (review?.stage !== "passed" || review.result === null) return null;
  const accepted = new Set(
    review.result.outcomeFactDecisions
      .filter((decision) => decision.decision === "accepted")
      .map((decision) => decision.id),
  );
  const facts = (review.outcomeFacts ?? [])
    .filter((fact) => accepted.has(fact.id))
    .map((fact) => resolveFact(fact, routes));
  return facts.some((fact) => fact === null)
    ? null
    : (facts as readonly CertifiedOutcomeFact[]);
}

function acceptedTransition(
  snapshot: RunSnapshot,
  completion: Completion,
  event: TransitionEvent,
): boolean {
  return (
    event.runId === completion.runId &&
    sameTask(event.task, completion.task) &&
    hasAcceptedLedgerEvidence(snapshot, event)
  );
}

function acceptedTransitions(
  snapshot: RunSnapshot,
  completion: Completion,
  transitions: readonly TransitionEvent[],
  routes: readonly TaskIdentity[],
): readonly TaskOutcomeTransition[] {
  return transitions
    .filter((event) => acceptedTransition(snapshot, completion, event))
    .map((event) => ({ ...event.transition, relevantTo: routes }))
    .sort(numericId);
}

export function projectTaskOutcome(
  snapshot: RunSnapshot,
  completion: Completion,
  transitions: readonly TransitionEvent[],
): ProjectedTaskOutcome | null {
  const task = snapshot.task;
  if (task === null || !matchesIndependentCompletion(snapshot, completion)) {
    return null;
  }
  const sourceIndex =
    task.outcomeTaskOrder?.findIndex((candidate) =>
      sameTask(candidate, task.identity),
    ) ?? -1;
  if (sourceIndex < 0) return null;
  const routes = task.outcomeRoutes ?? [];
  const facts = acceptedFacts(snapshot, routes);
  if (facts === null) return null;
  return {
    outcome: {
      attempt: completion.attempt,
      changedPaths: completion.changedPaths,
      facts: [...facts].sort(numericId),
      resultCommit: completion.resultCommit,
      runId: completion.runId,
      source: completion.task,
      transitions: acceptedTransitions(
        snapshot,
        completion,
        transitions,
        routes,
      ),
      verification: {
        command: completion.verification.command,
        exitCode: completion.verification.exitCode,
      },
    },
    sourceIndex,
  };
}

export function orderTaskOutcomes(
  projected: readonly ProjectedTaskOutcome[],
): readonly TaskOutcome[] {
  return [...projected]
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map(({ outcome }) => outcome);
}
