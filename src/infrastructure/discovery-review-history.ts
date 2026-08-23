import { isDeepStrictEqual } from "node:util";

import type {
  DiscoveryReviewRecord,
  RunJournalEvent,
  TaskIdentity,
} from "../core/contracts.js";
import { createLedgerState, transitionLedger } from "../core/ledger-state.js";

type ReviewCompleted = Extract<
  RunJournalEvent,
  { readonly type: "plan_compliance_review_completed" }
>;
type ReviewStarted = Extract<
  RunJournalEvent,
  { readonly type: "plan_compliance_review_started" }
>;
type TransitionEvent = Extract<
  RunJournalEvent,
  { readonly type: "ledger_transition_recorded" }
>;

function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function reviewStart(
  events: readonly RunJournalEvent[],
  index: number,
  completed: ReviewCompleted,
): ReviewStarted | undefined {
  return events
    .slice(0, index)
    .findLast(
      (event): event is ReviewStarted =>
        event.type === "plan_compliance_review_started" &&
        event.runId === completed.runId &&
        sameTask(event.task, completed.task) &&
        event.session.id === completed.session.id,
    );
}

function nextReviewStart(
  events: readonly RunJournalEvent[],
  index: number,
  completed: ReviewCompleted,
): number {
  const offset = events
    .slice(index + 1)
    .findIndex(
      (event) =>
        event.type === "plan_compliance_review_started" &&
        event.runId === completed.runId &&
        sameTask(event.task, completed.task),
    );
  return offset === -1 ? events.length : index + 1 + offset;
}

function appliedTransitions(
  events: readonly RunJournalEvent[],
): ReadonlyMap<TransitionEvent, boolean> {
  const transitions = events.filter(
    (event): event is TransitionEvent =>
      event.type === "ledger_transition_recorded",
  );
  let state = createLedgerState({
    assumptions: transitions
      .filter((event) => event.transition.kind === "assumption")
      .map((event) => event.transition.id),
    defaults: transitions
      .filter((event) => event.transition.kind === "default")
      .map((event) => event.transition.id),
  });
  const applied = new Map<TransitionEvent, boolean>();
  for (const event of transitions) {
    const result = transitionLedger(state, event.transition);
    applied.set(event, result.applied);
    state = result.state;
  }
  return applied;
}

function matchingTransition(
  events: readonly RunJournalEvent[],
  start: number,
  end: number,
  proposal: DiscoveryReviewRecord["proposal"],
  decision: DiscoveryReviewRecord["decision"],
): TransitionEvent | undefined {
  return events
    .slice(start, end)
    .find(
      (event): event is TransitionEvent =>
        event.type === "ledger_transition_recorded" &&
        isDeepStrictEqual(event.proposal, proposal) &&
        isDeepStrictEqual(event.decision, decision),
    );
}

export function projectDiscoveryReviews(
  events: readonly RunJournalEvent[],
): readonly DiscoveryReviewRecord[] {
  return projectDiscoveryReviewEntries(events).map(({ record }) => record);
}

export interface DiscoveryReviewEntry {
  readonly record: DiscoveryReviewRecord;
  readonly reviewIndex: number;
}

export function projectDiscoveryReviewEntries(
  events: readonly RunJournalEvent[],
): readonly DiscoveryReviewEntry[] {
  const applied = appliedTransitions(events);
  const records: DiscoveryReviewEntry[] = [];
  events.forEach((event, index) => {
    if (event.type !== "plan_compliance_review_completed") return;
    const started = reviewStart(events, index, event);
    const end = nextReviewStart(events, index, event);
    for (const proposal of started?.discoveries ?? []) {
      const decision = event.result.discoveryDecisions.find(
        (item) => item.kind === proposal.kind && item.id === proposal.id,
      );
      if (decision === undefined) continue;
      const transition = matchingTransition(
        events,
        index + 1,
        end,
        proposal,
        decision,
      );
      records.push({
        record: {
          applied:
            transition === undefined
              ? false
              : (applied.get(transition) ?? false),
          decision,
          proposal,
          ...(transition === undefined
            ? {}
            : { transition: transition.transition }),
        },
        reviewIndex: index,
      });
    }
  });
  return records;
}
