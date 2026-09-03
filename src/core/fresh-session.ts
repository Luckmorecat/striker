import type {
  AgentRunner,
  AgentRequest,
  AgentTurn,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  GitRepository,
  RunJournal,
} from "./contracts.js";
import {
  recordAttemptSession,
  recordInitializationInterruption,
  recordPreSessionAttention,
} from "./attempt-journal.js";
import { selectTaskOutcomeEvidence } from "./task-outcome-selection.js";
import type { RunRecoveryState } from "./run-journal-contracts.js";

type FreshSessionResult =
  | AgentTurn
  | Extract<
      DispatchResult,
      { status: "needs_attention"; task: ImplementationTask }
    >;

interface FreshSessionRequest {
  readonly attempt: number;
  readonly git?: GitRepository;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly runner: AgentRunner;
  readonly task: ImplementationTask;
}

type PreparedRequestResult =
  | { readonly request: AgentRequest; readonly status: "prepared" }
  | {
      readonly attention: Extract<
        DispatchResult,
        { status: "needs_attention"; task: ImplementationTask }
      >;
      readonly status: "needs_attention";
    };

function baseAgentRequest(input: FreshSessionRequest): AgentRequest {
  return {
    instructions: input.task.instructions,
    skills: input.request.skills,
    ...(input.task.execution === undefined
      ? {}
      : { workflowInstructions: input.task.execution.workflowInstructions }),
  };
}

async function preSessionAttention(
  input: FreshSessionRequest,
  detail: string,
  reason: "task_outcome_conflict" | "task_outcome_limit_exceeded",
): Promise<PreparedRequestResult> {
  const attention = await recordPreSessionAttention(
    input.journal,
    input.request,
    input.task,
    { detail, reason },
  );
  return { attention, status: "needs_attention" };
}

function requestWithEvidence(
  input: FreshSessionRequest,
  evidence: NonNullable<AgentRequest["priorTaskEvidence"]>,
): AgentRequest {
  if (evidence.length === 0) return baseAgentRequest(input);
  return { ...baseAgentRequest(input), priorTaskEvidence: evidence };
}

function selectEvidence(
  input: FreshSessionRequest,
  git: GitRepository,
  recovery: RunRecoveryState,
  execution: GitState,
) {
  return selectTaskOutcomeEvidence({
    execution,
    git,
    journalPlanId: recovery.planId,
    outcomes: recovery.taskOutcomes,
    planId: input.request.planId,
    routes: input.task.outcomePlanRoutes ?? [],
    target: input.task.identity,
    taskPlanId: input.task.outcomePlanId ?? "",
    taskOrder: input.task.outcomeTaskOrder ?? [],
  });
}

async function prepareAgentRequest(
  input: FreshSessionRequest,
): Promise<PreparedRequestResult> {
  const recovery = await input.journal.load(input.request.planId);
  if (recovery === null || recovery.taskOutcomes.length === 0) {
    return { request: baseAgentRequest(input), status: "prepared" };
  }
  if (input.git === undefined || input.task.execution === undefined) {
    return preSessionAttention(
      input,
      "Task Outcome ancestry validation is unavailable",
      "task_outcome_conflict",
    );
  }
  const execution = await input.git.inspect(input.task.execution.cwd);
  const selected = await selectEvidence(input, input.git, recovery, execution);
  if (selected.status !== "selected") {
    return preSessionAttention(
      input,
      selected.detail,
      selected.status === "conflict"
        ? "task_outcome_conflict"
        : "task_outcome_limit_exceeded",
    );
  }
  return {
    request: requestWithEvidence(input, selected.evidence),
    status: "prepared",
  };
}

export async function runInFreshSession(
  input: FreshSessionRequest,
): Promise<FreshSessionResult> {
  const callback = { entered: false };
  const prepared = await prepareAgentRequest(input);
  if (prepared.status === "needs_attention") return prepared.attention;
  const preparedRequest = prepared.request;
  try {
    return await input.runner.runInNewSession(
      preparedRequest,
      async (session) => {
        callback.entered = true;
        await recordAttemptSession(
          input.journal,
          input.request,
          input.task,
          input.attempt,
          session,
          preparedRequest,
        );
      },
    );
  } catch (error) {
    if (callback.entered) throw error;
    return recordInitializationInterruption(
      input.journal,
      input.request,
      input.task,
      input.attempt,
      error,
    );
  }
}
