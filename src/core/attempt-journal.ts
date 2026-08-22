import type {
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  RunAttention,
  RunJournal,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

export function replaceRunningAttempt(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  before: GitState | undefined,
  attempt: number,
  session: AgentSession | null,
): Promise<void> {
  return journal.replace({
    attempt,
    attention: null,
    before: before ?? null,
    request,
    runId: request.runId,
    session,
    status: "running",
    task,
  });
}

export async function recordAttemptSession(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  before: GitState | undefined,
  attempt: number,
  session: AgentSession,
): Promise<void> {
  await journal.append({
    attempt,
    runId: request.runId,
    session,
    task: task.identity,
    type: "task_session_started",
  });
  await replaceRunningAttempt(journal, request, task, before, attempt, session);
}

export async function recordInitializationInterruption(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  before: GitState | undefined,
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
  await journal.replace({
    attempt,
    attention,
    before: before ?? null,
    request,
    runId: request.runId,
    session: null,
    status: "needs_attention",
    task,
  });
  return {
    reason: attention.reason,
    runId: request.runId,
    session: null,
    status: "needs_attention",
    task,
  };
}
