import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  PlanComplianceReviewState,
  RunAttention,
  RunJournal,
  StandardsReviewState,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
} from "./contracts.js";
import {
  repairPlanComplianceFindings,
  runPlanComplianceReview,
} from "./plan-compliance-review.js";
import {
  repairStandardsFindings,
  runStandardsReview,
} from "./standards-review.js";
import { reviewedCandidateAttention } from "./dispatch-evidence.js";
import { transitionRun } from "./run-state.js";

interface CertificationDependencies {
  readonly git?: import("./contracts.js").GitRepository;
  readonly journal: RunJournal;
  readonly runner: AgentRunner;
}

interface TaskCertificationRequest {
  readonly attempt: number;
  readonly completion: TaskCompletionEvidence;
  readonly execution: TaskExecutionEvidence;
  readonly recheck: (
    output: string,
    rejectedCommit: string,
  ) => Promise<DispatchResult>;
  readonly request: DispatchRequest;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
}

interface CompletionCandidate {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion: TaskCompletionEvidence;
  readonly resultCommit: string;
  readonly startCommit: string;
  readonly verification: TaskExecutionEvidence["verification"];
}

function attentionResult(
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

async function appendCompletion(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  session: AgentSession,
  candidate: CompletionCandidate,
): Promise<DispatchResult> {
  transitionRun("running", "complete_task");
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

async function completePassedReview(
  dependencies: CertificationDependencies,
  input: TaskCertificationRequest,
): Promise<DispatchResult> {
  const candidate = {
    changedPaths: input.execution.changedPaths,
    resultCommit: input.execution.after.head,
    startCommit: input.execution.before.head,
  };
  const attention = await reviewedCandidateAttention(
    dependencies,
    input.task,
    input.execution.before,
    candidate,
  );
  if (attention !== null) {
    await dependencies.journal.append({
      attention,
      runId: input.request.runId,
      session: input.session,
      task: input.task.identity,
      type: "run_needs_attention",
    });
    return attentionResult(input.request, input.task, input.session, attention);
  }
  return appendCompletion(
    dependencies.journal,
    input.request,
    input.task,
    input.session,
    {
      attempt: input.attempt,
      ...candidate,
      completion: input.completion,
      verification: input.execution.verification,
    },
  );
}

async function certifyPlanCompliance(
  dependencies: CertificationDependencies,
  input: TaskCertificationRequest,
  standards: import("./contracts.js").StandardsReviewResult,
): Promise<DispatchResult> {
  const review = await runPlanComplianceReview({
    attempt: input.attempt,
    completion: input.completion,
    execution: input.execution,
    journal: dependencies.journal,
    request: input.request,
    runner: dependencies.runner,
    standards,
    task: input.task,
  });
  if (review.status === "interrupted") {
    return attentionResult(
      input.request,
      input.task,
      input.session,
      review.attention,
    );
  }
  if (review.status === "passed") {
    return completePassedReview(dependencies, input);
  }
  const repair = await repairPlanComplianceFindings({
    journal: dependencies.journal,
    request: input.request,
    result: review.result,
    runner: dependencies.runner,
    session: input.session,
    task: input.task,
  });
  return repair.status === "interrupted"
    ? attentionResult(
        input.request,
        input.task,
        input.session,
        repair.attention,
      )
    : input.recheck(repair.output, review.result.resultCommit);
}

export async function certifyTask(
  dependencies: CertificationDependencies,
  input: TaskCertificationRequest,
): Promise<DispatchResult> {
  const review = await runStandardsReview({
    attempt: input.attempt,
    completion: input.completion,
    execution: input.execution,
    journal: dependencies.journal,
    request: input.request,
    runner: dependencies.runner,
    task: input.task,
  });
  if (review.status === "interrupted") {
    return attentionResult(
      input.request,
      input.task,
      input.session,
      review.attention,
    );
  }
  if (review.status === "passed") {
    return certifyPlanCompliance(dependencies, input, review.result);
  }
  const repair = await repairStandardsFindings({
    journal: dependencies.journal,
    request: input.request,
    result: review.result,
    runner: dependencies.runner,
    session: input.session,
    task: input.task,
  });
  return repair.status === "interrupted"
    ? attentionResult(
        input.request,
        input.task,
        input.session,
        repair.attention,
      )
    : input.recheck(repair.output, review.result.resultCommit);
}

export function completeReviewedTask(
  journal: RunJournal,
  request: DispatchRequest,
  task: ImplementationTask,
  session: AgentSession,
  review: PlanComplianceReviewState,
): Promise<DispatchResult> {
  return appendCompletion(journal, request, task, session, {
    attempt: review.attempt,
    changedPaths: review.changedPaths,
    completion: review.completion,
    resultCommit: review.resultCommit,
    startCommit: review.startCommit,
    verification: review.verification,
  });
}

export function continueAfterStandardsReview(
  dependencies: CertificationDependencies,
  input: {
    readonly before: GitState;
    readonly recheck: TaskCertificationRequest["recheck"];
    readonly request: DispatchRequest;
    readonly review: StandardsReviewState;
    readonly session: AgentSession;
    readonly task: ImplementationTask;
  },
): Promise<DispatchResult> {
  if (input.review.result?.verdict !== "passed") {
    throw new Error("Plan compliance requires a passed standards review");
  }
  return certifyPlanCompliance(
    dependencies,
    {
      attempt: input.review.attempt,
      completion: input.review.completion,
      execution: {
        after: { ...input.before, head: input.review.resultCommit },
        before: input.before,
        changedPaths: input.review.changedPaths,
        commits: [input.review.resultCommit],
        verification: input.review.verification,
      },
      recheck: input.recheck,
      request: input.request,
      session: input.session,
      task: input.task,
    },
    input.review.result,
  );
}
