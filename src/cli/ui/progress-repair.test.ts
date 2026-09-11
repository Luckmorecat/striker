import { describe, expect, it } from "vitest";

import {
  blockedRun,
  blockingFinding,
  blockingResult,
  implementing,
  journal,
  passedOnB,
  progressDashboard,
  progressSession,
  progressTask,
  progressVerification,
  repairStarted,
  reviewCompleted,
  reviewStarted,
} from "../../testing/progress-fixtures.js";

describe("blocking review", () => {
  it("keeps the blocking review red while the pipeline stays truthful", () => {
    const dashboard = progressDashboard(...blockedRun);

    expect(dashboard.pipeline).toEqual([
      { note: null, stage: "Preparing", state: "passed" },
      { note: null, stage: "Implementing", state: "passed" },
      { note: null, stage: "Verifying", state: "passed" },
      { note: "2 blockers", stage: "Standards review", state: "blocked" },
      { note: null, stage: "Plan review", state: "pending" },
      { note: null, stage: "Completed", state: "pending" },
    ]);
    expect(dashboard.attention).toBeNull();
  });

  it("lists the blocking findings of the round that reported them", () => {
    const dashboard = progressDashboard(...blockedRun);

    expect(dashboard.findings).toEqual({
      headline: "! REVIEW · 2 blocking findings from round 1",
      items: [
        "  • Input consumed before eligibility is checked",
        "  • Cancelled input incorrectly resumes the session",
      ],
      status: "blocking",
    });
  });
});

describe("automatic repair", () => {
  it("opens the next round and marks previous checks recheck required", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
    );

    expect(dashboard.round).toBe(2);
    expect(dashboard.pipeline).toEqual([
      { note: null, stage: "Preparing", state: "passed" },
      { note: "round 2", stage: "Implementing", state: "active" },
      { note: "recheck required", stage: "Verifying", state: "recheck" },
      { note: "recheck due", stage: "Standards review", state: "blocked" },
      { note: null, stage: "Plan review", state: "pending" },
      { note: null, stage: "Completed", state: "pending" },
    ]);
    expect(dashboard.findings?.status).toBe("blocking");
  });

  it("retains the blocking history while the repaired candidate reverifies", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      journal({
        output: "repaired",
        result: blockingResult,
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "standards_repair_completed",
      }),
      { command: "pnpm check", kind: "verification", phase: "started" },
    );

    expect(dashboard.pipeline[2]).toEqual({
      note: "round 2",
      stage: "Verifying",
      state: "active",
    });
    expect(dashboard.pipeline[3]).toEqual({
      note: "recheck due",
      stage: "Standards review",
      state: "blocked",
    });
    expect(dashboard.findings?.status).toBe("blocking");
  });
});

describe("recheck and resolution", () => {
  it("shows the rechecking panel once the review reopens the candidate", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      reviewStarted("candidate-b"),
    );

    expect(dashboard.pipeline[3]).toEqual({
      note: "round 2",
      stage: "Standards review",
      state: "active",
    });
    expect(dashboard.findings).toEqual({
      headline: "RECHECKING · 2 findings from round 1",
      items: [
        "  • Input consumed before eligibility is checked",
        "  • Cancelled input incorrectly resumes the session",
      ],
      status: "rechecking",
    });
  });

  it("resolves findings only on the authoritative passing result", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      reviewStarted("candidate-b"),
      reviewCompleted(passedOnB),
    );

    expect(dashboard.pipeline[3]).toEqual({
      note: null,
      stage: "Standards review",
      state: "passed",
    });
    expect(dashboard.findings).toEqual({
      headline: "✓ Review history · round 1: 2 blockers → round 2: resolved",
      items: [],
      status: "resolved",
    });
  });
});

describe("round identity", () => {
  it("preserves the round when the same interrupted repair resumes", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      journal({
        attention: {
          detail: "paused",
          reason: "standards_repair_interrupted",
        },
        result: blockingResult,
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "standards_repair_interrupted",
      }),
      repairStarted(blockingResult),
    );

    expect(dashboard.round).toBe(2);
    expect(dashboard.attention).toBeNull();
  });

  it("opens a further round for a repair on a new candidate", () => {
    const second = { ...blockingResult, resultCommit: "candidate-b" };
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      reviewStarted("candidate-b"),
      reviewCompleted(second),
      repairStarted(second),
    );

    expect(dashboard.round).toBe(3);
    expect(dashboard.findings?.headline).toBe(
      "! REVIEW · 2 blocking findings from round 2",
    );
  });

  it("restarts rounds on an explicit retry", () => {
    const dashboard = progressDashboard(
      ...blockedRun,
      repairStarted(blockingResult),
      journal({
        attempt: 2,
        runId: "run",
        task: progressTask.identity,
        type: "run_retried",
      }),
    );

    expect(dashboard.round).toBe(1);
    expect(dashboard.session.attempt).toBe(2);
    expect(dashboard.findings).toBeNull();
    expect(dashboard.pipeline[3]).toEqual({
      note: null,
      stage: "Standards review",
      state: "pending",
    });
  });
});

describe("plan compliance repair", () => {
  const planBlocking = {
    discoveryDecisions: [],
    findings: [blockingFinding("Task coverage is incomplete")],
    kind: "plan_compliance" as const,
    outcomeFactDecisions: [],
    resultCommit: "candidate-a",
    startCommit: "base",
    verdict: "changes_required" as const,
  };
  const repaired = progressDashboard(
    ...implementing,
    journal({
      attempt: 1,
      changedPaths: ["src/a.ts"],
      completion: { summary: "done" },
      resultCommit: "candidate-a",
      runId: "run",
      session: progressSession,
      standards: passedOnB,
      startCommit: "base",
      task: progressTask.identity,
      type: "plan_compliance_review_started",
      verification: progressVerification,
    }),
    journal({
      result: planBlocking,
      runId: "run",
      session: progressSession,
      task: progressTask.identity,
      type: "plan_compliance_review_completed",
    }),
    journal({
      result: planBlocking,
      runId: "run",
      session: progressSession,
      task: progressTask.identity,
      type: "plan_compliance_repair_started",
    }),
  );

  it("opens its own round from the plan review candidate", () => {
    expect(repaired.round).toBe(2);
    expect(repaired.findings?.headline).toBe(
      "! REVIEW · 1 blocking finding from round 1",
    );
  });

  it("marks the earlier passing checks for recheck", () => {
    expect(repaired.pipeline[4]).toEqual({
      note: "recheck due",
      stage: "Plan review",
      state: "blocked",
    });
    expect(repaired.pipeline[3]).toEqual({
      note: "recheck required",
      stage: "Standards review",
      state: "recheck",
    });
  });
});
