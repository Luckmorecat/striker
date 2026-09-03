import type {
  AgentRequest,
  AgentRunner,
  AgentSession,
  DispatchResult,
  RunAttention,
  RunJournal,
} from "./contracts.js";
import {
  appendRunContinuation,
  type RecoverableRun,
} from "./recovery-context.js";
import { transitionRun } from "./run-state.js";

export interface InitialDeliveryRun extends RecoverableRun {
  readonly preparedRequest: AgentRequest;
  readonly session: AgentSession;
}

export function requiresInitialDeliveryRecovery(
  run: RecoverableRun,
): run is InitialDeliveryRun {
  return (
    run.session !== null &&
    run.preparedRequest !== null &&
    (run.status === "running" ||
      run.attention?.reason === "run_initialization_interrupted")
  );
}

export async function redeliverInitialRequest(input: {
  readonly journal: RunJournal;
  readonly run: InitialDeliveryRun;
  readonly runner: AgentRunner;
}): Promise<
  | { readonly output: string; readonly status: "returned" }
  | {
      readonly result: Extract<DispatchResult, { status: "needs_attention" }>;
      readonly status: "needs_attention";
    }
> {
  const { journal, run, runner } = input;
  transitionRun(run.status, "resume");
  await appendRunContinuation(journal, run);
  let turn;
  try {
    if (runner.resumeInitialSession === undefined) {
      throw new Error("the agent runner cannot redeliver initial requests");
    }
    turn = await runner.resumeInitialSession(run.session, {
      kind: "uncertain_initial_delivery",
      request: run.preparedRequest,
    });
  } catch (error) {
    return initialDeliveryFailure(journal, run, error);
  }
  if (
    turn.session.id !== run.session.id ||
    turn.session.resumeId !== run.session.resumeId
  ) {
    return initialDeliveryFailure(
      journal,
      run,
      new Error("Agent runner replaced the recorded implementation session"),
    );
  }
  if (turn.status === "failed") {
    return initialDeliveryFailure(journal, run, new Error(turn.error));
  }
  return { output: turn.output, status: "returned" };
}

async function initialDeliveryFailure(
  journal: RunJournal,
  run: InitialDeliveryRun,
  error: unknown,
): Promise<{
  readonly result: Extract<DispatchResult, { status: "needs_attention" }>;
  readonly status: "needs_attention";
}> {
  const message = error instanceof Error ? error.message : String(error);
  const failure =
    `Could not redeliver the durable initial request: ${message}`.slice(
      0,
      1_800,
    );
  const attention: RunAttention = {
    detail: `${failure}. Run \`striker resume\` to retry the exact request in the recorded session.`,
    reason: "run_initialization_interrupted",
  };
  transitionRun("running", "request_attention");
  await journal.append({
    attention,
    runId: run.request.runId,
    session: run.session,
    task: run.task.identity,
    type: "run_needs_attention",
  });
  return {
    result: {
      reason: attention.reason,
      runId: run.request.runId,
      session: run.session,
      status: "needs_attention",
      task: run.task,
    },
    status: "needs_attention",
  };
}
