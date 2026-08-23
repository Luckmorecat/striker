import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  ImplementationTask,
  PlanComplianceReviewResult,
  ReviewTurn,
  RunAttention,
  RunJournal,
  StandardsReviewResult,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
} from "./contracts.js";

interface PlanReviewRequest {
  readonly attempt: number;
  readonly completion: TaskCompletionEvidence;
  readonly execution: TaskExecutionEvidence;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly runner: AgentRunner;
  readonly standards: StandardsReviewResult;
  readonly task: ImplementationTask;
}

interface PlanRepairRequest {
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly result: PlanComplianceReviewResult;
  readonly runner: AgentRunner;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
}

export type PlanReviewOutcome =
  | {
      readonly result: PlanComplianceReviewResult;
      readonly status: "changes_required" | "passed";
    }
  | { readonly attention: RunAttention; readonly status: "interrupted" };

export type PlanRepairOutcome =
  | { readonly output: string; readonly status: "returned" }
  | { readonly attention: RunAttention; readonly status: "interrupted" };

function reviewInstructions(input: PlanReviewRequest): string {
  const evidence = {
    changedPaths: input.execution.changedPaths,
    resultCommit: input.execution.after.head,
    standardsResult: input.standards,
    startCommit: input.execution.before.head,
    task: {
      contract: input.task.instructions,
      identity: input.task.identity,
    },
    verification: input.execution.verification,
  };
  return [
    "# Independent plan-compliance review",
    "",
    "Review only the candidate below against the current task's Build, Paths, Test contract, and Verify sections, plus the immutable spine and map paths named in the task contract. Find missing or partial requirements, scope creep, changed public behavior, and task-plan conflicts. Do not modify files or run write commands.",
    "",
    JSON.stringify(evidence, null, 2),
    "",
    "Return one strict JSON object and no other text. Use kind `plan_compliance`, repeat the exact commits, set verdict to `passed` or `changes_required`, and include findings. Each finding needs kind (`plan_violation` or `defect`), severity, repository-relative changed path, location, rule, message, and fix. A changes_required verdict needs a blocking finding; passed permits no blocking findings.",
  ].join("\n");
}

function interruption(error: unknown): RunAttention {
  return {
    detail: (error instanceof Error ? error.message : String(error)).slice(
      0,
      2_000,
    ),
    reason: "plan_compliance_review_interrupted",
  };
}

function sameSession(left: AgentSession | null, right: AgentSession): boolean {
  return left?.id === right.id && left.resumeId === right.resumeId;
}

function validateResult(
  result: PlanComplianceReviewResult,
  execution: TaskExecutionEvidence,
): void {
  if (
    result.startCommit !== execution.before.head ||
    result.resultCommit !== execution.after.head
  ) {
    throw new Error("Plan-compliance result names different commits");
  }
  const invalid = result.findings.find(
    (finding) => !execution.changedPaths.includes(finding.path),
  );
  if (invalid !== undefined) {
    throw new Error(
      `Plan-compliance finding names unchanged path: ${invalid.path}`,
    );
  }
}

async function appendInterruption(
  input: PlanReviewRequest,
  session: AgentSession | null,
  error: unknown,
): Promise<Extract<PlanReviewOutcome, { status: "interrupted" }>> {
  const attention = interruption(error);
  await input.journal.append({
    attempt: input.attempt,
    attention,
    changedPaths: input.execution.changedPaths,
    completion: input.completion,
    resultCommit: input.execution.after.head,
    runId: input.request.runId,
    session,
    standards: input.standards,
    startCommit: input.execution.before.head,
    task: input.task.identity,
    type: "plan_compliance_review_interrupted",
    verification: input.execution.verification,
  });
  return { attention, status: "interrupted" };
}

function invokeReviewer(
  input: PlanReviewRequest,
  started: (session: AgentSession) => Promise<void>,
): Promise<ReviewTurn> {
  if (input.runner.runReviewInNewSession === undefined) {
    throw new Error("Agent runner does not support read-only reviews");
  }
  return input.runner.runReviewInNewSession(
    { instructions: reviewInstructions(input) },
    started,
  );
}

export async function runPlanComplianceReview(
  input: PlanReviewRequest,
): Promise<PlanReviewOutcome> {
  let startedSession: AgentSession | null = null;
  let turn: ReviewTurn;
  try {
    turn = await invokeReviewer(input, async (session) => {
      startedSession = session;
      await input.journal.append({
        attempt: input.attempt,
        changedPaths: input.execution.changedPaths,
        completion: input.completion,
        resultCommit: input.execution.after.head,
        runId: input.request.runId,
        session,
        standards: input.standards,
        startCommit: input.execution.before.head,
        task: input.task.identity,
        type: "plan_compliance_review_started",
        verification: input.execution.verification,
      });
    });
    if (turn.status === "failed") {
      return await appendInterruption(input, turn.session, turn.error);
    }
    if (!sameSession(startedSession, turn.session)) {
      throw new Error("Reviewer replaced its recorded session");
    }
    if (turn.result.kind !== "plan_compliance") {
      throw new Error("Plan-compliance reviewer returned the wrong kind");
    }
    validateResult(turn.result, input.execution);
  } catch (error) {
    return appendInterruption(input, startedSession, error);
  }
  await input.journal.append({
    result: turn.result,
    runId: input.request.runId,
    session: turn.session,
    task: input.task.identity,
    type: "plan_compliance_review_completed",
  });
  return { result: turn.result, status: turn.result.verdict };
}

function repairInstructions(result: PlanComplianceReviewResult): string {
  return [
    "# Independent plan-compliance review findings",
    "",
    JSON.stringify(result.findings, null, 2),
    "",
    "Repair every blocking finding in the current task. Amend the existing task commit, rerun affected checks and task verification, then return the strict implementation result required by the packaged workflow.",
  ].join("\n");
}

async function appendRepairInterruption(
  input: PlanRepairRequest,
  error: unknown,
): Promise<Extract<PlanRepairOutcome, { status: "interrupted" }>> {
  const attention: RunAttention = {
    detail: (error instanceof Error ? error.message : String(error)).slice(
      0,
      2_000,
    ),
    reason: "plan_compliance_repair_interrupted",
  };
  await input.journal.append({
    attention,
    result: input.result,
    runId: input.request.runId,
    session: input.session,
    task: input.task.identity,
    type: "plan_compliance_repair_interrupted",
  });
  return { attention, status: "interrupted" };
}

export async function repairPlanComplianceFindings(
  input: PlanRepairRequest,
): Promise<PlanRepairOutcome> {
  await input.journal.append({
    result: input.result,
    runId: input.request.runId,
    session: input.session,
    task: input.task.identity,
    type: "plan_compliance_repair_started",
  });
  try {
    const turn = await input.runner.resumeSession(
      input.session,
      repairInstructions(input.result),
    );
    if (turn.status === "failed") {
      return await appendRepairInterruption(input, turn.error);
    }
    if (!sameSession(input.session, turn.session)) {
      throw new Error("Agent runner replaced the implementation session");
    }
    await input.journal.append({
      output: turn.output,
      result: input.result,
      runId: input.request.runId,
      session: input.session,
      task: input.task.identity,
      type: "plan_compliance_repair_completed",
    });
    return { output: turn.output, status: "returned" };
  } catch (error) {
    return appendRepairInterruption(input, error);
  }
}
