import { describe, expect, it } from "vitest";

import type {
  PlanLogReader,
  PlanQueryDefinition,
  RunJournal,
  RunRecoveryState,
} from "./contracts.js";
import { PlanQueries } from "./plan-queries.js";

const firstTask = { id: "tasks/01.md", revision: "revision-1" };
const secondTask = { id: "tasks/02.md", revision: "revision-2" };
const plan: PlanQueryDefinition = {
  assumptions: [{ id: "A1", statement: "The CLI owns commands." }],
  defaults: [{ id: "D1", statement: "Use text output." }],
  planId: "plan-1",
  tasks: [firstTask, secondTask],
};

class QueryJournal implements RunJournal {
  constructor(private readonly recovery: RunRecoveryState | null) {}

  append(): Promise<void> {
    throw new Error("Unexpected append");
  }

  load(): Promise<RunRecoveryState | null> {
    return Promise.resolve(this.recovery);
  }

  loadActive(): Promise<RunRecoveryState | null> {
    throw new Error("Unexpected active-run query");
  }
}

class QueryLogReader implements PlanLogReader {
  constructor(
    private readonly content: string,
    private readonly expectedPlanId: string | null = "plan-1",
  ) {}

  read(planId: string | null): Promise<string> {
    expect(planId).toBe(this.expectedPlanId);
    return Promise.resolve(this.content);
  }
}

function pausedRecovery(): RunRecoveryState {
  const attention = {
    detail: "Verification failed.",
    reason: "verification_failed" as const,
  };
  const session = { id: "session-1", resumeId: "provider-1" };
  return {
    completedTasks: [firstTask],
    lastEvent: {
      attention,
      runId: "run-1",
      session,
      task: secondTask,
      type: "run_needs_attention",
    },
    planId: plan.planId,
    snapshot: {
      attempt: 2,
      attention,
      planId: plan.planId,
      request: {
        completedTasks: [firstTask],
        planId: plan.planId,
        runId: "run-1",
        skills: [],
        taskSource: { location: "/repo/plan", type: "striker-plan" },
      },
      runId: "run-1",
      session,
      status: "needs_attention",
      task: {
        identity: secondTask,
        instructions: "Build it.",
        title: "Second task",
      },
    },
  };
}

function sourceConflictRecovery(): RunRecoveryState {
  const recovery = pausedRecovery();
  if (recovery.snapshot === null) throw new Error("Missing test snapshot");
  const snapshot = { ...recovery.snapshot };
  delete snapshot.attempt;
  return {
    ...recovery,
    lastEvent: {
      current: secondTask,
      runId: "run-1",
      task: firstTask,
      type: "run_source_changed",
    },
    snapshot: { ...snapshot, attention: null, session: null, task: null },
  };
}

describe("plan queries", () => {
  it("returns a not-started view without reading a projection", async () => {
    const reader = new QueryLogReader("# Plan log\n", null);
    const queries = new PlanQueries(new QueryJournal(null), reader);

    await expect(queries.status(plan)).resolves.toEqual({
      activeRun: null,
      assumptions: [
        { id: "A1", state: "recorded", statement: "The CLI owns commands." },
      ],
      attention: null,
      defaults: [
        { id: "D1", state: "recorded", statement: "Use text output." },
      ],
      planId: "plan-1",
      reviews: [],
      status: "not_started",
      tasks: [
        { id: "tasks/01.md", revision: "revision-1", state: "pending" },
        { id: "tasks/02.md", revision: "revision-2", state: "pending" },
      ],
    });
    await expect(queries.log(plan.planId)).resolves.toBe("# Plan log\n");
  });

  it("derives completed and active task state from replayed events", async () => {
    const queries = new PlanQueries(
      new QueryJournal(pausedRecovery()),
      new QueryLogReader("# Plan log\n\n## First task\n"),
    );

    await expect(queries.status(plan)).resolves.toMatchObject({
      activeRun: { attempt: 2, runId: "run-1" },
      attention: {
        detail: "Verification failed.",
        reason: "verification_failed",
      },
      status: "needs_attention",
      reviews: [
        {
          plan: "passed",
          standards: "passed",
          task: firstTask,
        },
      ],
      tasks: [
        { id: "tasks/01.md", revision: "revision-1", state: "completed" },
        { id: "tasks/02.md", revision: "revision-2", state: "active" },
      ],
    });
    await expect(queries.log(plan.planId)).resolves.toContain("## First task");
  });

  it("reports source-conflict attention with both task revisions", async () => {
    const queries = new PlanQueries(
      new QueryJournal(sourceConflictRecovery()),
      new QueryLogReader("unused"),
    );

    await expect(queries.status(plan)).resolves.toMatchObject({
      attention: {
        detail:
          "Completed task tasks/01.md@revision-1 now resolves to tasks/02.md@revision-2.",
        reason: "completed_task_changed",
      },
      status: "needs_attention",
    });
  });
});
