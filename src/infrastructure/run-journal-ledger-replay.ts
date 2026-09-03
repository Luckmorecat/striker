import { isDeepStrictEqual } from "node:util";

import type { RunJournalEvent, RunSnapshot } from "../core/contracts.js";
import { ledgerTransitionPause } from "../core/ledger-state.js";
import { transitionRun } from "../core/run-state.js";

export type LedgerEvent = Extract<
  RunJournalEvent,
  { type: "ledger_attention_answered" | "ledger_transition_recorded" }
>;

export function isLedgerEvent(event: RunJournalEvent): event is LedgerEvent {
  return (
    event.type === "ledger_attention_answered" ||
    event.type === "ledger_transition_recorded"
  );
}

function requireSelectedTask(
  snapshot: RunSnapshot,
  event: Extract<LedgerEvent, { type: "ledger_transition_recorded" }>,
): void {
  const selected = snapshot.task?.identity;
  if (
    selected?.id !== event.task.id ||
    selected.revision !== event.task.revision
  ) {
    throw new Error("Striker run event contradicts its selected task");
  }
}

export function hasAcceptedLedgerEvidence(
  snapshot: RunSnapshot,
  event: Extract<LedgerEvent, { type: "ledger_transition_recorded" }>,
): boolean {
  const review = snapshot.planComplianceReview;
  const expected =
    event.proposal.kind === "assumption"
      ? {
          id: event.proposal.id,
          kind: "assumption",
          state: event.proposal.state,
        }
      : { id: event.proposal.id, kind: "default", state: "deviated" };
  return (
    review?.stage === "passed" &&
    event.decision.kind === event.proposal.kind &&
    event.decision.id === event.proposal.id &&
    review.discoveries?.some((proposal) =>
      isDeepStrictEqual(proposal, event.proposal),
    ) === true &&
    review.result?.discoveryDecisions.some(
      (decision) =>
        decision.decision === "accepted" &&
        isDeepStrictEqual(decision, event.decision),
    ) === true &&
    isDeepStrictEqual(event.transition, expected)
  );
}

function replayTransition(
  snapshot: RunSnapshot,
  event: Extract<LedgerEvent, { type: "ledger_transition_recorded" }>,
  applied: boolean,
): RunSnapshot {
  requireSelectedTask(snapshot, event);
  if (!hasAcceptedLedgerEvidence(snapshot, event)) {
    throw new Error("Ledger transition lacks accepted review evidence");
  }
  if (!applied) return snapshot;
  const attention = ledgerTransitionPause(
    event.transition,
    event.decision.reason,
  );
  if (attention === null) return snapshot;
  return {
    ...snapshot,
    attention,
    status:
      snapshot.status === "running"
        ? transitionRun(snapshot.status, "request_attention")
        : snapshot.status,
  };
}

function replayAnswer(snapshot: RunSnapshot): RunSnapshot {
  const reason = snapshot.attention?.reason;
  if (
    snapshot.status !== "needs_attention" ||
    snapshot.task !== null ||
    (reason !== "assumption_disproved" &&
      reason !== "assumption_needs_decision")
  ) {
    throw new Error("Ledger answer has no completed discovery pause");
  }
  return {
    ...snapshot,
    attention: null,
    status: transitionRun(snapshot.status, "answer"),
  };
}

export function replayLedgerEvent(
  snapshot: RunSnapshot,
  event: LedgerEvent,
  transitionApplied = true,
): RunSnapshot {
  return event.type === "ledger_transition_recorded"
    ? replayTransition(snapshot, event, transitionApplied)
    : replayAnswer(snapshot);
}
