import type {
  AgentSession,
  DispatchRequest,
  DispatchResult,
  ImplementationTask,
  RunAttention,
  RunJournal,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
} from "./contracts.js";

export interface CompletionCandidate {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion: TaskCompletionEvidence;
  readonly resultCommit: string;
  readonly startCommit: string;
  readonly verification: TaskExecutionEvidence["verification"];
}

export function certificationAttentionResult(
  request: DispatchRequest,
  task: ImplementationTask,
  session: AgentSession,
  attention: RunAttention,
): DispatchResult {
  return {
    reason: attention.reason,
    runId: request.runId,
    session,
    status: "needs_attention",
    task,
  };
}

export async function appendTaskCompletion(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  session: AgentSession,
  candidate: CompletionCandidate,
): Promise<DispatchResult> {
  await journal.append({
    attempt: candidate.attempt,
    certification: "independent_reviews",
    changedPaths: candidate.changedPaths,
    completedAt: new Date().toISOString(),
    resultCommit: candidate.resultCommit,
    runId: request.runId,
    session,
    startCommit: candidate.startCommit,
    task: task.identity,
    type: "task_completed",
    verification: candidate.verification,
  });
  return {
    evidence: candidate.completion,
    runId: request.runId,
    session,
    status: "completed",
    task,
  };
}
