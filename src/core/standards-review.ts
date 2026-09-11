import { runRepairSession } from "./repair-session.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  ImplementationTask,
  StandardsReviewResult,
  ReviewTurn,
  RunAttention,
  RunJournal,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
} from "./contracts.js";

interface StandardsReviewRequest {
  readonly preservedSession?: AgentSession | null;
  readonly attempt: number;
  readonly completion: TaskCompletionEvidence;
  readonly execution: TaskExecutionEvidence;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly runner: AgentRunner;
  readonly task: ImplementationTask;
}

export type StandardsReviewOutcome =
  | {
      readonly result: StandardsReviewResult;
      readonly status: "changes_required" | "passed";
    }
  | {
      readonly attention: RunAttention;
      readonly status: "interrupted";
    };

interface StandardsRepairRequest {
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly result: StandardsReviewResult;
  readonly runner: AgentRunner;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
}

export type StandardsRepairOutcome =
  | { readonly output: string; readonly status: "returned" }
  | {
      readonly attention: RunAttention;
      readonly status: "interrupted";
    };

function reviewInstructions(input: StandardsReviewRequest): string {
  const evidence = {
    changedPaths: input.execution.changedPaths,
    resultCommit: input.execution.after.head,
    startCommit: input.execution.before.head,
    task: input.task.identity,
    verification: input.execution.verification,
  };
  return [
    "# Independent standards review",
    "",
    "Review only the candidate described below. Read every repository rule that governs a changed path. Report mandatory rule breaches and concrete defects. Do not modify files, run write commands, or review work outside the changed paths.",
    "",
    JSON.stringify(evidence, null, 2),
    "",
    "Return one strict JSON object and no other text. Use kind `standards`, repeat the exact startCommit and resultCommit, set verdict to `passed` or `changes_required`, and include findings. Each finding needs kind (`rule_violation` or `defect`), severity (`blocking` or `advisory`), repository-relative path, location with a positive line and optional endLine, rule, message, and fix. A changes_required verdict needs at least one blocking finding; passed permits no blocking findings.",
  ].join("\n");
}

function validateResult(
  result: StandardsReviewResult,
  execution: TaskExecutionEvidence,
): void {
  if (
    result.startCommit !== execution.before.head ||
    result.resultCommit !== execution.after.head
  ) {
    throw new Error("Standards review result names different commits");
  }
  const invalidPath = result.findings.find(
    (finding) => !execution.changedPaths.includes(finding.path),
  );
  if (invalidPath !== undefined) {
    throw new Error(
      `Standards review finding names unchanged path: ${invalidPath.path}`,
    );
  }
}

function reviewInterruption(error: unknown): RunAttention {
  return {
    detail: (error instanceof Error ? error.message : String(error)).slice(
      0,
      2_000,
    ),
    reason: "standards_review_interrupted",
  };
}

function sameSession(left: AgentSession | null, right: AgentSession): boolean {
  return left?.id === right.id && left.resumeId === right.resumeId;
}

async function appendInterruption(
  input: StandardsReviewRequest,
  session: AgentSession | null,
  error: unknown,
): Promise<Extract<StandardsReviewOutcome, { status: "interrupted" }>> {
  const attention = reviewInterruption(error);
  await input.journal.append({
    attempt: input.attempt,
    attention,
    changedPaths: input.execution.changedPaths,
    completion: input.completion,
    resultCommit: input.execution.after.head,
    runId: input.request.runId,
    session,
    startCommit: input.execution.before.head,
    task: input.task.identity,
    type: "standards_review_interrupted",
    verification: input.execution.verification,
  });
  return { attention, status: "interrupted" };
}

async function invokeReviewer(
  input: StandardsReviewRequest,
  sessionStarted: (session: AgentSession) => Promise<void>,
): Promise<ReviewTurn> {
  if (input.preservedSession?.execution) {
    if (!input.runner.resumeReviewSession)
      throw new Error("Runner cannot resume isolated reviews");
    await sessionStarted(input.preservedSession);
    return input.runner.resumeReviewSession(input.preservedSession);
  }
  if (input.runner.runReviewInNewSession === undefined) {
    throw new Error("Agent runner does not support read-only reviews");
  }
  return input.runner.runReviewInNewSession(
    { instructions: reviewInstructions(input) },
    sessionStarted,
  );
}

export async function runStandardsReview(
  input: StandardsReviewRequest,
): Promise<StandardsReviewOutcome> {
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
        startCommit: input.execution.before.head,
        task: input.task.identity,
        type: "standards_review_started",
        verification: input.execution.verification,
      });
    });
    if (turn.status === "failed") {
      return await appendInterruption(input, turn.session, turn.error);
    }
    if (!sameSession(startedSession, turn.session)) {
      throw new Error("Reviewer replaced its recorded session");
    }
    if (turn.result.kind !== "standards") {
      throw new Error("Standards reviewer returned the wrong kind");
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
    type: "standards_review_completed",
  });
  return { result: turn.result, status: turn.result.verdict };
}

function repairInstructions(result: StandardsReviewResult): string {
  return [
    "# Independent standards review findings",
    "",
    JSON.stringify(result.findings, null, 2),
    "",
    "Repair every blocking finding in the current task. Keep the task to one descendant commit by amending its existing commit. Rerun the affected checks and the task verification, then return the implementation completion evidence required by the packaged workflow.",
  ].join("\n");
}

function repairInterruption(error: unknown): RunAttention {
  return {
    detail: (error instanceof Error ? error.message : String(error)).slice(
      0,
      2_000,
    ),
    reason: "standards_repair_interrupted",
  };
}

async function appendRepairInterruption(
  input: StandardsRepairRequest,
  error: unknown,
): Promise<Extract<StandardsRepairOutcome, { status: "interrupted" }>> {
  const attention = repairInterruption(error);
  await input.journal.append({
    attention,
    result: input.result,
    runId: input.request.runId,
    session: input.session,
    task: input.task.identity,
    type: "standards_repair_interrupted",
  });
  return { attention, status: "interrupted" };
}

export async function repairStandardsFindings(
  input: StandardsRepairRequest,
): Promise<StandardsRepairOutcome> {
  let session = input.session;
  const delivery = { begun: false };

  let output: string;
  try {
    const turn = await runRepairSession(
      input,
      repairInstructions(input.result),
      async (value) => {
        session = value;
        await input.journal.append({
          result: input.result,
          runId: input.request.runId,
          session: value,
          task: input.task.identity,
          type: "standards_repair_started",
        });
        delivery.begun = true;
      },
    );
    if (turn.status === "failed") {
      return await appendRepairInterruption({ ...input, session }, turn.error);
    }
    if (!sameSession(session, turn.session)) {
      throw new Error("Agent runner replaced the implementation session");
    }
    output = turn.output;
  } catch (error) {
    if (!delivery.begun) {
      const attention: RunAttention = {
        reason: "standards_repair_interrupted",
        detail: error instanceof Error ? error.message : String(error),
      };
      await input.journal.append({
        type: "run_needs_attention",
        runId: input.request.runId,
        task: input.task.identity,
        session,
        attention,
      });
      return { attention, status: "interrupted" };
    }
    return appendRepairInterruption({ ...input, session }, error);
  }
  await input.journal.append({
    output,
    result: input.result,
    runId: input.request.runId,
    session,
    task: input.task.identity,
    type: "standards_repair_completed",
  });
  return { output, status: "returned" };
}
