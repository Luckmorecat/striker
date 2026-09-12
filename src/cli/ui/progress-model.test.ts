import { describe, expect, it } from "vitest";

import type { RunObservation } from "../../core/run-observation.js";
import {
  attemptStarted,
  implementing,
  journal,
  progressDashboard,
  progressSession,
  progressTask,
  runStarted,
  stageStates,
  taskCertified,
  verifying,
} from "../../testing/progress-fixtures.js";

const note = (text: string): RunObservation => ({
  activity: "note",
  kind: "activity",
  text,
});
const tool = (text: string): RunObservation => ({
  activity: "tool",
  kind: "activity",
  text,
});

describe("initial progress", () => {
  it("shows preparation active with no certified stage", () => {
    const dashboard = progressDashboard();

    expect(dashboard.stage).toBe("Preparing");
    expect(stageStates(dashboard)).toEqual({
      Preparing: "active",
      Implementing: "pending",
      Verifying: "pending",
      "Standards review": "pending",
      "Plan review": "pending",
      Completed: "pending",
    });
  });

  it("reports no certified task and no session before any fact arrives", () => {
    const dashboard = progressDashboard();

    expect(dashboard.plan).toEqual({
      certified: 0,
      tasks: [
        { id: "01", state: "pending", title: "Recovery contracts" },
        { id: "02", state: "pending", title: "Answer command" },
      ],
      total: 2,
    });
    expect(dashboard.session).toEqual({
      attempt: 0,
      backend: "Docker",
      id: null,
    });
    expect(dashboard.findings).toBeNull();
    expect(dashboard.finished).toBeNull();
  });
});

describe("preparation", () => {
  it("carries a preparation detail without inventing a stage result", () => {
    const dashboard = progressDashboard({
      detail: "Opening the retained workspace.",
      kind: "preparation",
      phase: "started",
    });

    expect(dashboard.stage).toBe("Preparing");
    expect(dashboard.live).toBe("Opening the retained workspace.");
    expect(stageStates(dashboard).Preparing).toBe("active");
  });

  it("keeps preparation failures out of the certified stages", () => {
    const dashboard = progressDashboard({
      detail: "Docker is unavailable.",
      kind: "preparation",
      phase: "failed",
    });

    expect(stageStates(dashboard)).toEqual({
      Preparing: "attention",
      Implementing: "pending",
      Verifying: "pending",
      "Standards review": "pending",
      "Plan review": "pending",
      Completed: "pending",
    });
    expect(dashboard.live).toBe("Docker is unavailable.");
  });
});

describe("implementation facts", () => {
  it("certifies preparation and activates implementation", () => {
    const dashboard = progressDashboard(...implementing);

    expect(dashboard.stage).toBe("Implementing");
    expect(stageStates(dashboard)).toEqual({
      Preparing: "passed",
      Implementing: "active",
      Verifying: "pending",
      "Standards review": "pending",
      "Plan review": "pending",
      Completed: "pending",
    });
    expect(dashboard.session).toEqual({
      attempt: 1,
      backend: "Docker",
      id: "session-42",
    });
  });

  it("marks the selected task active in the plan panel", () => {
    const dashboard = progressDashboard(...implementing);

    expect(dashboard.plan.tasks).toEqual([
      { id: "01", state: "pending", title: "Recovery contracts" },
      { id: "02", state: "active", title: "Answer command" },
    ]);
    expect(dashboard.plan.certified).toBe(0);
    expect(dashboard.round).toBe(1);
  });

  it("reports verification in flight without certifying it", () => {
    const dashboard = progressDashboard(...implementing, verifying);

    expect(dashboard.stage).toBe("Verifying");
    expect(stageStates(dashboard).Verifying).toBe("active");
    expect(stageStates(dashboard).Implementing).toBe("passed");
    expect(dashboard.tool).toBe("Run pnpm check");
  });
});

describe("completion facts", () => {
  it("certifies a task without completing the run", () => {
    const dashboard = progressDashboard(...implementing, taskCertified);

    expect(dashboard.plan.certified).toBe(1);
    expect(dashboard.plan.tasks[1]).toEqual({
      id: "02",
      state: "certified",
      title: "Answer command",
    });
    expect(dashboard.finished).toBeNull();
  });

  it("completes the run only on the run completion fact", () => {
    const dashboard = progressDashboard(
      ...implementing,
      taskCertified,
      journal({ runId: "run", type: "run_completed" }),
    );

    expect(dashboard.finished).toBe("completed");
    expect(stageStates(dashboard).Completed).toBe("passed");
  });

  it("reports an exhausted source separately from a certified run", () => {
    const dashboard = progressDashboard(
      runStarted,
      journal({ runId: "run", type: "run_completed" }),
    );

    expect(dashboard.finished).toBe("exhausted");
    expect(dashboard.plan.certified).toBe(0);
    // Preparation did complete; nothing after it ran.
    expect(stageStates(dashboard)).toEqual({
      Preparing: "passed",
      Implementing: "pending",
      Verifying: "pending",
      "Standards review": "pending",
      "Plan review": "pending",
      Completed: "pending",
    });
    expect(dashboard.pipeline[1]?.note).toBe("no task to certify");
  });

  it("reports the export outcome apart from run completion", () => {
    const dashboard = progressDashboard(
      ...implementing,
      journal({
        error: "branch missing",
        head: "candidate-b",
        runId: "run",
        type: "result_export_failed",
      }),
    );

    expect(dashboard.export).toEqual({ head: "candidate-b", status: "failed" });
    expect(dashboard.finished).toBeNull();
  });

  it("reports a failed run from its authoritative fact", () => {
    const dashboard = progressDashboard(
      ...implementing,
      journal({
        error: "agent crashed",
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "run_failed",
      }),
    );

    expect(dashboard.finished).toBe("failed");
    expect(dashboard.live).toBe("Run failed: agent crashed");
  });
});

describe("attention", () => {
  it("marks the stage in flight rather than inventing a new one", () => {
    const dashboard = progressDashboard(
      ...implementing,
      journal({
        attention: {
          detail: "Should blank answers reprompt?",
          reason: "assumption_needs_decision",
        },
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "run_needs_attention",
      }),
    );

    expect(stageStates(dashboard).Implementing).toBe("attention");
    expect(dashboard.attention).toEqual({
      detail: "Should blank answers reprompt?",
      reason: "assumption_needs_decision",
    });
  });

  it("clears attention when the answer returns to implementation", () => {
    const dashboard = progressDashboard(
      ...implementing,
      journal({
        attention: { detail: "Answer needed", reason: "assumption_disproved" },
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "run_needs_attention",
      }),
      journal({
        answer: "Reprompt on blank answers.",
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "run_answered",
      }),
    );

    expect(dashboard.attention).toBeNull();
    expect(stageStates(dashboard).Implementing).toBe("active");
  });

  it("keeps the attempt when an interrupted run resumes", () => {
    const dashboard = progressDashboard(
      ...implementing,
      attemptStarted,
      journal({
        runId: "run",
        session: progressSession,
        task: progressTask.identity,
        type: "run_resumed",
      }),
    );

    expect(dashboard.session.attempt).toBe(1);
    expect(dashboard.round).toBe(1);
  });
});

describe("live activity", () => {
  it("shows a visible agent note on the live line", () => {
    const dashboard = progressDashboard(
      ...implementing,
      note("Reading recovery-policy.ts"),
    );

    expect(dashboard.live).toBe("Reading recovery-policy.ts");
    expect(dashboard.stage).toBe("Implementing");
  });

  it("shows the newest tool summary and keeps the note", () => {
    const dashboard = progressDashboard(
      ...implementing,
      note("Fixing the eligibility check"),
      tool("Read recovery-policy.ts"),
      tool("Edit answer-command.ts"),
    );

    expect(dashboard.live).toBe("Fixing the eligibility check");
    expect(dashboard.tool).toBe("Edit answer-command.ts");
  });

  it("reports no activity until the agent supplies some", () => {
    const dashboard = progressDashboard(...implementing);

    expect(dashboard.tool).toBe("No activity reported");
    expect(dashboard.live).toBe("Implementing task 02 · round 1.");
  });

  it("drops activity that arrives after the run finished", () => {
    const dashboard = progressDashboard(
      ...implementing,
      taskCertified,
      journal({ runId: "run", type: "run_completed" }),
      note("Late chatter from a closed turn"),
      tool("Edit stale.ts"),
    );

    expect(dashboard.live).toBe("Run completed.");
    expect(dashboard.tool).toBe("Commit candida");
  });

  it("forgets the previous task's activity when the next one is selected", () => {
    const dashboard = progressDashboard(
      ...implementing,
      tool("Edit answer-command.ts"),
      journal({
        runId: "run",
        task: { ...progressTask, identity: { id: "03", revision: "r1" } },
        type: "task_selected",
      }),
    );

    expect(dashboard.tool).toBe("No activity reported");
  });
});
