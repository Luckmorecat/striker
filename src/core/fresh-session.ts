import type {
  AgentRunner,
  AgentTurn,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  RunJournal,
} from "./contracts.js";
import {
  recordAttemptSession,
  recordInitializationInterruption,
} from "./attempt-journal.js";

type FreshSessionResult =
  | AgentTurn
  | Extract<
      DispatchResult,
      { status: "needs_attention"; task: ImplementationTask }
    >;

interface FreshSessionRequest {
  readonly attempt: number;
  readonly before: GitState | undefined;
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly runner: AgentRunner;
  readonly task: ImplementationTask;
}

export async function runInFreshSession(
  input: FreshSessionRequest,
): Promise<FreshSessionResult> {
  const callback = { entered: false };
  try {
    return await input.runner.runInNewSession(
      {
        instructions: input.task.instructions,
        skills: input.request.skills,
        ...(input.task.execution === undefined
          ? {}
          : {
              workflowInstructions: input.task.execution.workflowInstructions,
            }),
      },
      async (session) => {
        callback.entered = true;
        await recordAttemptSession(
          input.journal,
          input.request,
          input.task,
          input.before,
          input.attempt,
          session,
        );
      },
    );
  } catch (error) {
    if (callback.entered) throw error;
    return recordInitializationInterruption(
      input.journal,
      input.request,
      input.task,
      input.before,
      input.attempt,
      error,
    );
  }
}
