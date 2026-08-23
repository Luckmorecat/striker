import { describe, expect, it } from "vitest";

import { createLedgerState, transitionLedger } from "./ledger-state.js";

describe("plan ledger transitions", () => {
  it("applies each legal assumption and default transition once", () => {
    const initial = createLedgerState({
      assumptions: ["A1", "A2"],
      defaults: ["D1"],
    });

    const confirmed = transitionLedger(initial, {
      id: "A1",
      kind: "assumption",
      state: "confirmed",
    });
    const disproved = transitionLedger(confirmed.state, {
      id: "A2",
      kind: "assumption",
      state: "disproved",
    });
    const deviated = transitionLedger(disproved.state, {
      id: "D1",
      kind: "default",
      state: "deviated",
    });

    expect(confirmed.applied).toBe(true);
    expect(disproved.applied).toBe(true);
    expect(deviated).toEqual({
      applied: true,
      state: {
        assumptions: { A1: "confirmed", A2: "disproved" },
        defaults: { D1: "deviated" },
      },
    });
  });

  it("leaves the prior state intact for unknown, repeated, or conflicting transitions", () => {
    const initial = createLedgerState({
      assumptions: ["A1"],
      defaults: ["D1"],
    });
    const confirmed = transitionLedger(initial, {
      id: "A1",
      kind: "assumption",
      state: "confirmed",
    });

    for (const transition of [
      { id: "A1", kind: "assumption", state: "confirmed" },
      { id: "A1", kind: "assumption", state: "disproved" },
      { id: "A9", kind: "assumption", state: "needs_decision" },
      { id: "D9", kind: "default", state: "deviated" },
    ] as const) {
      const result = transitionLedger(confirmed.state, transition);
      expect(result.applied).toBe(false);
      expect(result.state).toBe(confirmed.state);
    }
  });
});
