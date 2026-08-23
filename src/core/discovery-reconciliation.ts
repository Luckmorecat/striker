import type {
  DispatchRequest,
  PlanComplianceReviewResult,
  RunAttention,
  RunJournal,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "./contracts.js";
import type { ResolvedDiscoveryProposal } from "./discovery-contracts.js";
import {
  createLedgerState,
  ledgerTransitionPause,
  transitionLedger,
  type PlanLedgerTransition,
} from "./ledger-state.js";

type TransitionEvent = Extract<
  RunJournalEvent,
  { type: "ledger_transition_recorded" }
>;

export function isCompletedDiscoveryPause(
  snapshot: RunSnapshot | null,
): snapshot is RunSnapshot & {
  readonly status: "needs_attention";
  readonly task: null;
} {
  const reason = snapshot?.attention?.reason;
  return (
    snapshot?.status === "needs_attention" &&
    snapshot.task === null &&
    (reason === "assumption_disproved" ||
      reason === "assumption_needs_decision")
  );
}

export async function answerDiscoveryPause(
  journal: RunJournal,
  snapshot: RunSnapshot | null,
  answer: string,
): Promise<DispatchRequest | null> {
  if (!isCompletedDiscoveryPause(snapshot)) return null;
  await journal.append({
    answer,
    runId: snapshot.runId,
    type: "ledger_attention_answered",
  });
  return snapshot.request;
}

function proposalKey(value: { readonly id: string; readonly kind: string }) {
  return `${value.kind}:${value.id}`;
}

function proposedTransition(
  proposal: ResolvedDiscoveryProposal,
): PlanLedgerTransition {
  return proposal.kind === "assumption"
    ? { id: proposal.id, kind: proposal.kind, state: proposal.state }
    : { id: proposal.id, kind: proposal.kind, state: "deviated" };
}

function initialState(
  existing: readonly TransitionEvent[],
  proposed: readonly ResolvedDiscoveryProposal[],
) {
  const all = [
    ...existing.map((event) => event.transition),
    ...proposed.map(proposedTransition),
  ];
  let state = createLedgerState({
    assumptions: all
      .filter((transition) => transition.kind === "assumption")
      .map((transition) => transition.id),
    defaults: all
      .filter((transition) => transition.kind === "default")
      .map((transition) => transition.id),
  });
  for (const event of existing) {
    state = transitionLedger(state, event.transition).state;
  }
  return state;
}

function matchesRecoveredTransition(
  candidate: TransitionEvent,
  runId: string,
  task: TaskIdentity,
  transition: PlanLedgerTransition,
): boolean {
  return (
    candidate.runId === runId &&
    candidate.task.id === task.id &&
    candidate.task.revision === task.revision &&
    candidate.transition.kind === transition.kind &&
    candidate.transition.id === transition.id &&
    candidate.transition.state === transition.state
  );
}

function recoveredTransitionAttention(
  existing: readonly TransitionEvent[],
  runId: string,
  task: TaskIdentity,
  transition: PlanLedgerTransition,
): RunAttention | null {
  let state = createLedgerState({
    assumptions: existing
      .filter((event) => event.transition.kind === "assumption")
      .map((event) => event.transition.id),
    defaults: existing
      .filter((event) => event.transition.kind === "default")
      .map((event) => event.transition.id),
  });
  let event: TransitionEvent | undefined;
  for (const candidate of existing) {
    const result = transitionLedger(state, candidate.transition);
    state = result.state;
    if (
      result.applied &&
      matchesRecoveredTransition(candidate, runId, task, transition)
    ) {
      event = candidate;
    }
  }
  return event === undefined
    ? null
    : ledgerTransitionPause(event.transition, event.decision.reason);
}

export async function reconcileReviewedDiscoveries(
  journal: RunJournal,
  planId: string,
  runId: string,
  task: TaskIdentity,
  proposals: readonly ResolvedDiscoveryProposal[],
  review: PlanComplianceReviewResult,
): Promise<RunAttention | null> {
  const recovery = await journal.load(planId);
  const existing = recovery?.ledgerTransitions ?? [];
  let state = initialState(existing, proposals);
  let attention: RunAttention | null = null;
  const decisions = new Map(
    review.discoveryDecisions.map((decision) => [
      proposalKey(decision),
      decision,
    ]),
  );
  for (const proposal of proposals) {
    const decision = decisions.get(proposalKey(proposal));
    if (decision?.decision !== "accepted") continue;
    const transition = proposedTransition(proposal);
    const result = transitionLedger(state, transition);
    if (!result.applied) {
      attention =
        recoveredTransitionAttention(existing, runId, task, transition) ??
        attention;
      continue;
    }
    await journal.append({
      decision,
      proposal,
      runId,
      task,
      transition,
      type: "ledger_transition_recorded",
    });
    state = result.state;
    attention = ledgerTransitionPause(transition, decision.reason) ?? attention;
  }
  return attention;
}
