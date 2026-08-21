import type {
  AgentSession,
  DispatchRequest,
  GitState,
  ImplementationTask,
  RunJournal,
} from "./contracts.js";

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
