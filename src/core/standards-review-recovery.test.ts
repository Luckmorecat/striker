import { describe, expect, it } from "vitest";

import { FakeAgentRunner, InMemoryRunJournal } from "../testing/fakes.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentSession,
  DispatchRequest,
  GitRepository,
  GitState,
  StandardsReviewResult,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
} from "./contracts.js";
import { Dispatcher } from "./dispatcher.js";

const task = {
  execution: {
    affectedPaths: ["src/task.ts"],
    cwd: "/repo",
    verifyCommand: "pnpm check",
    workflowInstructions: "implement",
  },
  identity: { id: "tasks/05.md", revision: "revision-5" },
  instructions: "Build standards review.",
  title: "Review the candidate",
} as const;
const request: DispatchRequest = {
  completedTasks: [],
  planId: "plan-review-recovery",
  runId: "run-review-recovery",
  skills: [],
  taskSource: { location: "memory://plan", type: "memory" },
};
const implementor = { id: "implementor", resumeId: "provider" };
const verification = { command: "pnpm check", exitCode: 0, output: "ok" };

function state(head: string): GitState {
  return {
    dirtyPaths: [],
    head,
    root: "/repo",
    trackedPatch: "",
    untrackedHashes: {},
  };
}

function reviewResult(
  resultCommit: string,
  verdict: StandardsReviewResult["verdict"] = "passed",
): StandardsReviewResult {
  const finding = {
    fix: "Split the function.",
    kind: "rule_violation",
    location: { line: 10 },
    message: "The function exceeds the limit.",
    path: "src/task.ts",
    rule: "Functions must stay within 80 logical lines.",
    severity: "blocking",
  } as const;
  return {
    findings: verdict === "passed" ? [] : [finding],
    kind: "standards",
    resultCommit,
    startCommit: "baseline",
    verdict,
  };
}

class Source implements TaskSource {
  completionEvidence(): Promise<TaskCompletionResult> {
    return Promise.resolve({
      evidence: { summary: "implementation complete" },
      status: "completed",
    });
  }

  nextTask(completed: readonly TaskIdentity[]) {
    return Promise.resolve(completed.length === 0 ? task : null);
  }

  reconcileCompleted(): Promise<null> {
    return Promise.resolve(null);
  }
}

class RepairGit implements GitRepository {
  constructor(public head = "candidate-2") {}

  changedPaths(): Promise<readonly string[]> {
    return Promise.resolve(["src/task.ts"]);
  }

  commitsBetween(): Promise<readonly string[]> {
    return Promise.resolve([this.head]);
  }

  inspect(): Promise<GitState> {
    return Promise.resolve(state(this.head));
  }

  resolvePrivatePath(): Promise<string> {
    return Promise.resolve("/repo/.git/striker");
  }

  resolveRoot(): Promise<string> {
    return Promise.resolve("/repo");
  }
}

async function seedImplementation(
  journal: InMemoryRunJournal,
  session: AgentSession = implementor,
): Promise<void> {
  await journal.append({
    planId: request.planId,
    request,
    runId: request.runId,
    type: "run_started",
  });
  await journal.append({ runId: request.runId, task, type: "task_selected" });
  await journal.append({
    before: state("baseline"),
    runId: request.runId,
    task: task.identity,
    type: "task_baseline_recorded",
  });
  await journal.append({
    attempt: 1,
    runId: request.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
  await journal.append({
    attempt: 1,
    request: { instructions: task.instructions, skills: [] },
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
}

async function seedChangesRequired(
  journal: InMemoryRunJournal,
  session: AgentSession = implementor,
): Promise<StandardsReviewResult> {
  await seedImplementation(journal, session);
  const result = reviewResult("candidate-1", "changes_required");
  await journal.append(reviewStarted());
  await journal.append({
    result,
    runId: request.runId,
    session: { id: "reviewer-1" },
    task: task.identity,
    type: "standards_review_completed",
  });
  return result;
}

function reviewStarted() {
  return {
    attempt: 1,
    changedPaths: ["src/task.ts"],
    completion: { summary: "implementation complete" },
    resultCommit: "candidate-1",
    runId: request.runId,
    session: { id: "reviewer-1" },
    startCommit: "baseline",
    task: task.identity,
    type: "standards_review_started" as const,
    verification,
  };
}

function dispatcher(
  journal: InMemoryRunJournal,
  runner: FakeAgentRunner,
  git: GitRepository = new RepairGit(),
  verify = () => Promise.resolve(verification),
): Dispatcher {
  const adapters = new AdapterRegistry();
  adapters.register({
    open: () => Promise.resolve(new Source()),
    type: "memory",
  });
  return new Dispatcher({
    adapters,
    git,
    journal,
    runner,
    verifier: { verify },
  });
}

describe("standards review recovery", () => {
  it("replaces an interrupted reviewer with a fresh pinned review", async () => {
    const journal = new InMemoryRunJournal();
    await seedImplementation(journal);
    await journal.append(reviewStarted());
    const runner = new FakeAgentRunner(
      { output: "unused", session: implementor, status: "returned" },
      {
        result: reviewResult("candidate-1"),
        session: { id: "reviewer-2" },
        status: "returned",
      },
    );

    await expect(
      dispatcher(journal, runner, new RepairGit("candidate-1")).resume(),
    ).resolves.toMatchObject({ status: "completed" });

    expect(runner.reviewRequests).toHaveLength(2);
    expect(runner.reviewRequests[1]?.instructions).toContain(
      "# Independent plan-compliance review",
    );
    expect(runner.resumeRequests).toEqual([]);
    expect(runner.initialResumeRequests).toEqual([]);
    expect(
      journal.events.filter(
        (event) => event.type === "standards_review_interrupted",
      ),
    ).toHaveLength(1);
    expect(journal.releasedRunIds).toEqual([request.runId]);
  });

  it("rejects a passed review when the checkout has changed", async () => {
    const journal = new InMemoryRunJournal();
    await seedImplementation(journal);
    await journal.append(reviewStarted());
    await journal.append({
      result: reviewResult("candidate-1"),
      runId: request.runId,
      session: { id: "reviewer-1" },
      task: task.identity,
      type: "standards_review_completed",
    });
    const runner = new FakeAgentRunner({
      output: "unused",
      session: implementor,
      status: "returned",
    });

    await expect(dispatcher(journal, runner).resume()).resolves.toMatchObject({
      reason: "commit_evidence_missing",
      status: "needs_attention",
    });
    expect(journal.snapshots.at(-1)?.standardsReview).toBeNull();
    expect(
      journal.events.some((event) => event.type === "task_completed"),
    ).toBe(false);
  });
});

describe("standards repair commit recovery", () => {
  it("keeps requiring an amendment after attention", async () => {
    const journal = new InMemoryRunJournal();
    const result = await seedChangesRequired(journal);
    await journal.append({
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_started",
    });
    await journal.append({
      output: "unchanged repair",
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_completed",
    });
    const git = new RepairGit("candidate-1");
    const runner = new FakeAgentRunner({
      output: "amended repair",
      session: implementor,
      status: "returned",
    });
    const host = dispatcher(journal, runner, git);

    await expect(host.resume()).resolves.toMatchObject({
      reason: "commit_evidence_missing",
      status: "needs_attention",
    });
    expect(journal.snapshots.at(-1)?.standardsReview?.stage).toBe(
      "repair_attention",
    );
    git.head = "candidate-2";
    await expect(host.answer("Amend it.")).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("standards repair recovery", () => {
  it("continues an interrupted repair before re-verifying and reviewing", async () => {
    const journal = new InMemoryRunJournal();
    const firstResult = await seedChangesRequired(journal);
    await journal.append({
      result: firstResult,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_started",
    });
    await journal.append({
      attention: {
        detail: "repair disconnected",
        reason: "standards_repair_interrupted",
      },
      result: firstResult,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_interrupted",
    });
    const runner = new FakeAgentRunner(
      { output: "repair complete", session: implementor, status: "returned" },
      {
        result: reviewResult("candidate-2"),
        session: { id: "reviewer-2" },
        status: "returned",
      },
    );

    await expect(dispatcher(journal, runner).resume()).resolves.toMatchObject({
      status: "completed",
    });

    expect(runner.resumeRequests[0]?.instructions).toContain(
      "Split the function.",
    );
    expect(runner.reviewRequests).toHaveLength(2);
    const repairCompleted = journal.events.findIndex(
      (event) => event.type === "standards_repair_completed",
    );
    expect(repairCompleted).toBeGreaterThanOrEqual(0);
    expect(repairCompleted).toBeLessThan(
      journal.events.findIndex(
        (event) =>
          event.type === "standards_review_started" &&
          event.resultCommit === "candidate-2",
      ),
    );
    expect(
      journal.events.findLast((event) => event.type === "task_completed"),
    ).toMatchObject({ resultCommit: "candidate-2" });
  });
});

describe("interrupted standards repair amendment", () => {
  it("still rejects the original candidate after repair resumes", async () => {
    const journal = new InMemoryRunJournal();
    const result = await seedChangesRequired(journal);
    await journal.append({
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_started",
    });
    await journal.append({
      attention: {
        detail: "repair disconnected",
        reason: "standards_repair_interrupted",
      },
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_interrupted",
    });
    const runner = new FakeAgentRunner({
      output: "unchanged repair",
      session: implementor,
      status: "returned",
    });

    await expect(
      dispatcher(journal, runner, new RepairGit("candidate-1")).resume(),
    ).resolves.toMatchObject({
      reason: "commit_evidence_missing",
      status: "needs_attention",
    });
    expect(runner.reviewRequests).toEqual([]);
    expect(journal.snapshots.at(-1)?.standardsReview?.stage).toBe(
      "repair_attention",
    );
  });
});

describe("retried standards repair amendment", () => {
  it("keeps the rejected commit across a fresh attempt", async () => {
    const journal = new InMemoryRunJournal();
    const result = await seedChangesRequired(journal);
    await journal.append({
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_started",
    });
    await journal.append({
      attention: {
        detail: "repair disconnected",
        reason: "standards_repair_interrupted",
      },
      result,
      runId: request.runId,
      session: implementor,
      task: task.identity,
      type: "standards_repair_interrupted",
    });
    const git = new RepairGit("candidate-1");
    const retrySession = { id: "retry", resumeId: "retry-provider" };
    const runner = new FakeAgentRunner([
      { output: "unchanged retry", session: retrySession, status: "returned" },
      { output: "amended retry", session: retrySession, status: "returned" },
    ]);
    const host = dispatcher(journal, runner, git);

    await expect(host.retry()).resolves.toMatchObject({
      reason: "commit_evidence_missing",
      status: "needs_attention",
    });
    expect(journal.snapshots.at(-1)?.standardsReview?.stage).toBe(
      "repair_attention",
    );
    expect(runner.reviewRequests).toEqual([]);
    git.head = "candidate-2";
    await expect(host.answer("Amend it.")).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("post-repair evidence recovery", () => {
  it.each([false, true])(
    "returns failed evidence to the preserved repair thread (isolated: %s)",
    async (isolated) => {
      const repair = isolated
        ? {
            id: "repair",
            execution: {
              environmentId: "a".repeat(64),
              stageId: "cdd9e33b-5b67-48de-b0d6-f6cb3f6fef76",
              inputId: "b".repeat(64),
            },
          }
        : implementor;
      const journal = new InMemoryRunJournal();
      const result = await seedChangesRequired(
        journal,
        isolated ? { ...repair, id: "implementation" } : implementor,
      );
      await journal.append({
        result,
        runId: request.runId,
        session: repair,
        task: task.identity,
        type: "standards_repair_started",
      });
      await journal.append({
        output: "repair complete",
        result,
        runId: request.runId,
        session: repair,
        task: task.identity,
        type: "standards_repair_completed",
      });
      const runner = new FakeAgentRunner({
        output: "verification fixed",
        session: repair,
        status: "returned",
      });
      const results = [
        { ...verification, exitCode: 1, output: "failed" },
        verification,
      ];
      const host = dispatcher(journal, runner, new RepairGit(), () =>
        Promise.resolve(results.shift() ?? verification),
      );

      await expect(host.resume()).resolves.toMatchObject({
        reason: "verification_failed",
        status: "needs_attention",
      });
      expect(journal.snapshots.at(-1)?.standardsReview?.stage).toBe(
        "repair_attention",
      );
      await expect(host.answer("Fix verification.")).resolves.toMatchObject({
        status: "completed",
      });
      expect(runner.resumeRequests).toMatchObject([{ session: repair }]);
    },
  );
});

describe("standards review developer answers", () => {
  it("rejects answers while review recovery owns the next action", async () => {
    const journal = new InMemoryRunJournal();
    await seedImplementation(journal);
    await journal.append(reviewStarted());
    const runner = new FakeAgentRunner({
      output: "unused",
      session: implementor,
      status: "returned",
    });

    await expect(
      dispatcher(journal, runner).answer("Ignore it."),
    ).rejects.toThrow("does not accept developer answers");
    expect(runner.resumeRequests).toEqual([]);
  });
});
