export type AssumptionLedgerState =
  "confirmed" | "disproved" | "needs_decision" | "recorded";
export type DefaultLedgerState = "deviated" | "recorded";

export interface PlanLedgerState {
  readonly assumptions: Readonly<Record<string, AssumptionLedgerState>>;
  readonly defaults: Readonly<Record<string, DefaultLedgerState>>;
}

export type PlanLedgerTransition =
  | {
      readonly id: string;
      readonly kind: "assumption";
      readonly state: Exclude<AssumptionLedgerState, "recorded">;
    }
  | {
      readonly id: string;
      readonly kind: "default";
      readonly state: "deviated";
    };

interface LedgerDefinitions {
  readonly assumptions: readonly string[];
  readonly defaults: readonly string[];
}

export interface LedgerTransitionResult {
  readonly applied: boolean;
  readonly state: PlanLedgerState;
}

export interface LedgerTransitionPause {
  readonly detail: string;
  readonly reason: "assumption_disproved" | "assumption_needs_decision";
}

export function ledgerTransitionPause(
  transition: PlanLedgerTransition,
  reason: string,
): LedgerTransitionPause | null {
  if (transition.kind !== "assumption" || transition.state === "confirmed") {
    return null;
  }
  return {
    detail: `${transition.id}: ${reason}`,
    reason:
      transition.state === "disproved"
        ? "assumption_disproved"
        : "assumption_needs_decision",
  };
}

export function createLedgerState(
  definitions: LedgerDefinitions,
): PlanLedgerState {
  return {
    assumptions: Object.fromEntries(
      definitions.assumptions.map((id) => [id, "recorded"]),
    ),
    defaults: Object.fromEntries(
      definitions.defaults.map((id) => [id, "recorded"]),
    ),
  };
}

export function transitionLedger(
  current: PlanLedgerState,
  transition: PlanLedgerTransition,
): LedgerTransitionResult {
  const entries =
    transition.kind === "assumption" ? current.assumptions : current.defaults;
  if (entries[transition.id] !== "recorded") {
    return { applied: false, state: current };
  }
  return {
    applied: true,
    state: {
      ...current,
      [transition.kind === "assumption" ? "assumptions" : "defaults"]: {
        ...entries,
        [transition.id]: transition.state,
      },
    },
  };
}

export function replayLedgerTransitions(
  transitions: readonly PlanLedgerTransition[],
): PlanLedgerState {
  const definitions = {
    assumptions: transitions
      .filter((transition) => transition.kind === "assumption")
      .map((transition) => transition.id),
    defaults: transitions
      .filter((transition) => transition.kind === "default")
      .map((transition) => transition.id),
  };
  return transitions.reduce(
    (state, transition) => transitionLedger(state, transition).state,
    createLedgerState(definitions),
  );
}
