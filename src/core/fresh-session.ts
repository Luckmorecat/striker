import type {
  AgentRunner,
  AgentTurn,
  DispatchRequest,
  DispatchResult,
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
  readonly journal: RunJournal;
  readonly request: DispatchRequest;
  readonly runner: AgentRunner;
  readonly task: ImplementationTask;
}

export async function runInFreshSession(
  input: FreshSessionRequest,
): Promise<FreshSessionResult> {
  const callback = { entered: false };
  const preparedRequest = {
    instructions: input.task.instructions,
    skills: input.request.skills,
    ...(input.task.execution === undefined
      ? {}
      : {
          workflowInstructions: input.task.execution.workflowInstructions,
        }),
  };
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
