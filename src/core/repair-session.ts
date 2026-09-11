import type {
  AgentRunner,
  AgentSession,
  AgentTurn,
  DispatchRequest,
  ReviewResult,
  RunJournal,
} from "./contracts.js";

export async function runRepairSession(
  input: {
    readonly journal: RunJournal;
    readonly request: DispatchRequest;
    readonly result: ReviewResult;
    readonly runner: AgentRunner;
    readonly session: AgentSession;
  },
  instructions: string,
  started: (session: AgentSession) => Promise<void>,
): Promise<AgentTurn> {
  if (!input.session.execution) {
    await started(input.session);
    return input.runner.resumeSession(input.session, instructions);
  }
  const snapshot = (await input.journal.load(input.request.planId))?.snapshot;
  const review =
    input.result.kind === "standards"
      ? snapshot?.standardsReview
      : snapshot?.planComplianceReview;
  if (review?.stage === "repair_interrupted" && review.repairSession) {
    await started(review.repairSession);
    return input.runner.resumeSession(review.repairSession, instructions);
  }
  const prepared = snapshot?.preparedRequest;
  if (!prepared) throw new Error("Fresh repair requires frozen task inputs");
  return input.runner.runInNewSession(
    {
      ...prepared,
      instructions: `${prepared.instructions}\n\n${instructions}\n\n# Reviewed candidate evidence\n${JSON.stringify(input.result)}`,
    },
    started,
  );
}
