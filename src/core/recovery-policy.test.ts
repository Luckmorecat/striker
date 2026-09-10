import { describe, expect, it } from "vitest";
import type { RunRecoveryState, RunSnapshot } from "./contracts.js";
import { recoveryBlocker, validateRecovery } from "./recovery-policy.js";

const task = {
  identity: { id: "01", revision: "one" },
  title: "Task",
  instructions: "Build",
};
const request = {
  runId: "run",
  planId: "plan",
  completedTasks: [],
  skills: [],
  taskSource: { type: "memory", location: "plan" },
};
function recovery(overrides: Partial<RunSnapshot> = {}): RunRecoveryState {
  return {
    completedTasks: [],
    taskOutcomes: [],
    planId: "plan",
    lastEvent: { type: "run_started", runId: "run", planId: "plan", request },
    snapshot: {
      runId: "run",
      planId: "plan",
      request,
      status: "needs_attention",
      task,
      session: { id: "session" },
      ...overrides,
    },
  };
}

describe("recovery availability", () => {
  it("allows taskless completed discovery answers but rejects resume and retry", () => {
    const state = recovery({
      task: null,
      session: null,
      attention: {
        reason: "assumption_needs_decision",
        detail: "Choose a contract",
      },
    });
    expect(recoveryBlocker(state, "answer")).toBeNull();
    expect(recoveryBlocker(state, "resume")).toContain("developer answer");
    expect(recoveryBlocker(state, "retry")).toContain(
      "missing recovery context",
    );
    expect(() => {
      validateRecovery(state, "answer");
    }).not.toThrow();
  });
  it("rejects sessionless answers and completed-task retries", () => {
    expect(recoveryBlocker(recovery({ session: null }), "answer")).toContain(
      "no session",
    );
    expect(
      recoveryBlocker(
        { ...recovery(), completedTasks: [task.identity] },
        "retry",
      ),
    ).toContain("completed Striker task");
    expect(
      recoveryBlocker(recovery({ status: "running" }), "answer"),
    ).toContain("No recoverable");
  });
  it("reserves owned reviews for recovery, but permits repair-attention answers", () => {
    const review = {
      attempt: 1,
      changedPaths: [],
      completion: { summary: "done" },
      result: null,
      resultCommit: "after",
      repairOutput: null,
      reviewSession: null,
      stage: "reviewing" as const,
      startCommit: "before",
      verification: { command: "check", exitCode: 0, output: "ok" },
    };
    expect(
      recoveryBlocker(recovery({ standardsReview: review }), "answer"),
    ).toContain("does not accept");
    expect(
      recoveryBlocker(
        recovery({ standardsReview: { ...review, stage: "repair_attention" } }),
        "answer",
      ),
    ).toBeNull();
  });
});
