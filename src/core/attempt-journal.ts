import type {
  AgentRequest,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  ImplementationTask,
  RunAttention,
  RunJournal,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

export function recordAttemptStart(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  attempt: number,
): Promise<void> {
  return journal.append({
    attempt,
    runId: request.runId,
    task: task.identity,
    type: "task_attempt_started",
  });
}

export async function recordAttemptSession(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  attempt: number,
  session: AgentSession,
  preparedRequest: AgentRequest,
): Promise<void> {
  await journal.append({
    attempt,
    request: preparedRequest,
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
}

export async function recordInitializationInterruption(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  attempt: number,
  error: unknown,
): Promise<
  Extract<
    DispatchResult,
    { status: "needs_attention"; task: ImplementationTask }
  >
> {
  const message = error instanceof Error ? error.message : String(error);
  const failure =
    `Could not initialize a durable task session: ${message}`.slice(0, 1_800);
  const attention: RunAttention = {
    detail: `${failure}. Run \`striker retry\` to start a fresh attempt.`,
    reason: "run_initialization_interrupted",
  };
  transitionRun("running", "request_attention");
  await journal.append({
    attention,
    runId: request.runId,
    session: null,
    task: task.identity,
    type: "run_needs_attention",
  });
  return {
    reason: attention.reason,
    runId: request.runId,
    session: null,
    status: "needs_attention",
    task,
  };
}

export async function recordPreSessionAttention(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  attention: RunAttention,
): Promise<
  Extract<
    DispatchResult,
    { status: "needs_attention"; task: ImplementationTask }
  >
> {
  transitionRun("running", "request_attention");
  await journal.append({
    attention,
    runId: request.runId,
    session: null,
    task: task.identity,
    type: "run_needs_attention",
  });
  return {
    reason: attention.reason,
    runId: request.runId,
    session: null,
    status: "needs_attention",
    task,
  };
}
