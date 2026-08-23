import type {
  AgentRequest,
  AgentRunner,
  AgentTurn,
  AgentSession,
  HarnessPreflightRequest,
  ImplementationTask,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  ReviewRequest,
  ReviewTurn,
  TaskCompletionEvidence,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
  TaskSourceAdapter,
  VerificationResult,
} from "../core/contracts.js";
import { terminalRunStatus } from "../core/run-state.js";
import { replayPlanJournal } from "../infrastructure/run-journal-sequence.js";

class InMemoryTaskSource implements TaskSource {
  constructor(
    private readonly tasks: readonly ImplementationTask[],
    private readonly evidence: Readonly<
      Record<string, TaskCompletionEvidence | undefined>
    >,
  ) {}

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    return Promise.resolve(
      this.tasks.find(
        (task) =>
          !completed.some(
            (identity) =>
              identity.id === task.identity.id &&
              identity.revision === task.identity.revision,
          ),
      ) ?? null,
    );
  }

  reconcileCompleted(completed: readonly TaskIdentity[]): Promise<{
    completed: TaskIdentity;
    current: TaskIdentity | null;
  } | null> {
    for (const identity of completed) {
      const current = this.tasks.find(
        (task) => task.identity.id === identity.id,
      );
      if (current === undefined) {
        return Promise.resolve({ completed: identity, current: null });
      }
      if (current.identity.revision !== identity.revision) {
        return Promise.resolve({
          completed: identity,
          current: current.identity,
        });
      }
    }
    return Promise.resolve(null);
  }

  completionEvidence(task: ImplementationTask): Promise<TaskCompletionResult> {
    const evidence = this.evidence[task.identity.id];
    return Promise.resolve(
      evidence === undefined
        ? {
            attention: {
              detail: "The task source did not provide completion evidence.",
              reason: "completion_evidence_missing",
            },
            status: "needs_attention",
          }
        : { evidence, status: "completed" },
    );
  }
}

export class InMemoryTaskSourceAdapter implements TaskSourceAdapter {
  constructor(
    readonly type: string,
    private readonly tasks: readonly ImplementationTask[],
    private readonly evidence: Readonly<
      Record<string, TaskCompletionEvidence | undefined>
    >,
  ) {}

  open(): Promise<TaskSource> {
    return Promise.resolve(new InMemoryTaskSource(this.tasks, this.evidence));
  }
}

export class FakeAgentRunner implements AgentRunner {
  lastRequest: AgentRequest | null = null;
  readonly preflightRequests: HarnessPreflightRequest[] = [];
  readonly requests: AgentRequest[] = [];
  readonly reviewRequests: ReviewRequest[] = [];
  readonly resumeRequests: {
    readonly instructions: string;
    readonly session: AgentSession;
  }[] = [];
  readonly #turns: AgentTurn[];
  readonly #reviewTurns: ReviewTurn[];

  constructor(
    turn: AgentTurn | readonly AgentTurn[],
    reviewTurns: ReviewTurn | readonly ReviewTurn[] | null = null,
  ) {
    this.#turns = "status" in turn ? [turn] : [...turn];
    this.#reviewTurns =
      reviewTurns === null
        ? []
        : "status" in reviewTurns
          ? [reviewTurns]
          : [...reviewTurns];
  }

  preflight(request: HarnessPreflightRequest): Promise<void> {
    this.preflightRequests.push(request);
    return Promise.resolve();
  }

  async runInNewSession(
    request: AgentRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<AgentTurn> {
    this.lastRequest = request;
    this.requests.push(request);
    const turn = this.#turns.shift();
    if (turn === undefined) throw new Error("Missing fake agent turn");
    await sessionStarted?.(turn.session);
    return turn;
  }

  resumeSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn> {
    this.resumeRequests.push({ instructions, session });
    const turn = this.#turns.shift();
    if (turn === undefined) throw new Error("Missing fake agent turn");
    return Promise.resolve(turn);
  }

  async runReviewInNewSession(
    request: ReviewRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<ReviewTurn> {
    this.reviewRequests.push(request);
    const turn =
      this.#reviewTurns.shift() ??
      (request.instructions.includes("# Independent plan-compliance review")
        ? passedPlanComplianceReview(request)
        : passedStandardsReview(request));
    await sessionStarted?.(turn.session);
    return turn;
  }
}

export function passedPlanComplianceReview(request: ReviewRequest): ReviewTurn {
  const startCommit = /"startCommit": "([^"]+)"/u.exec(
    request.instructions,
  )?.[1];
  const resultCommit = /"resultCommit": "([^"]+)"/u.exec(
    request.instructions,
  )?.[1];
  if (startCommit === undefined || resultCommit === undefined) {
    throw new Error("Fake plan review request is missing candidate commits");
  }
  return {
    result: {
      discoveryDecisions: [],
      findings: [],
      kind: "plan_compliance",
      resultCommit,
      startCommit,
      verdict: "passed",
    },
    session: { id: "plan-compliance-review" },
    status: "returned",
  };
}

export function passedStandardsReview(request: ReviewRequest): ReviewTurn {
  const startCommit = /"startCommit": "([^"]+)"/u.exec(
    request.instructions,
  )?.[1];
  const resultCommit = /"resultCommit": "([^"]+)"/u.exec(
    request.instructions,
  )?.[1];
  if (startCommit === undefined || resultCommit === undefined) {
    throw new Error("Fake review request is missing candidate commits");
  }
  return {
    result: {
      findings: [],
      kind: "standards",
      resultCommit,
      startCommit,
      verdict: "passed",
    },
    session: { id: "standards-review" },
    status: "returned",
  };
}

export async function runPassingStandardsReview(
  request: ReviewRequest,
  sessionStarted?: (session: AgentSession) => Promise<void>,
): Promise<ReviewTurn> {
  const turn = passedStandardsReview(request);
  await sessionStarted?.(turn.session);
  return turn;
}

export async function runPassingReview(
  request: ReviewRequest,
  sessionStarted?: (session: AgentSession) => Promise<void>,
): Promise<ReviewTurn> {
  const turn = request.instructions.includes(
    "# Independent plan-compliance review",
  )
    ? passedPlanComplianceReview(request)
    : passedStandardsReview(request);
  await sessionStarted?.(turn.session);
  return turn;
}

interface PassedReviewEvidence {
  readonly attempt: number;
  readonly changedPaths: readonly string[];
  readonly completion?: TaskCompletionEvidence;
  readonly resultCommit: string;
  readonly runId: string;
  readonly startCommit: string;
  readonly task: TaskIdentity;
  readonly verification: VerificationResult;
}

export function passedStandardsReviewEvents(
  evidence: PassedReviewEvidence,
): readonly RunJournalEvent[] {
  const session = { id: "standards-review" };
  const completion = evidence.completion ?? { summary: "task complete" };
  const result = {
    findings: [],
    kind: "standards" as const,
    resultCommit: evidence.resultCommit,
    startCommit: evidence.startCommit,
    verdict: "passed" as const,
  };
  return [
    {
      attempt: evidence.attempt,
      changedPaths: evidence.changedPaths,
      completion,
      resultCommit: evidence.resultCommit,
      runId: evidence.runId,
      session,
      startCommit: evidence.startCommit,
      task: evidence.task,
      type: "standards_review_started",
      verification: evidence.verification,
    },
    {
      result,
      runId: evidence.runId,
      session,
      task: evidence.task,
      type: "standards_review_completed",
    },
  ];
}

export async function appendPassedStandardsReview(
  journal: RunJournal,
  evidence: PassedReviewEvidence,
): Promise<void> {
  for (const event of passedStandardsReviewEvents(evidence)) {
    await journal.append(event);
  }
}

export class InMemoryRunJournal implements RunJournal {
  readonly releasedRunIds: string[] = [];
  readonly events: RunJournalEvent[] = [];
  readonly snapshots: RunSnapshot[] = [];

  append(event: RunJournalEvent): Promise<void> {
    const planId = this.planIdFor(event);
    const events = [...this.eventsForPlan(planId), event];
    const recovery = replayPlanJournal(events, planId);
    this.events.push(event);
    this.snapshots.push(recovery.snapshot);
    if (terminalRunStatus(event) !== null) {
      this.releasedRunIds.push(event.runId);
    }
    return Promise.resolve();
  }

  load(planId: string): Promise<RunRecoveryState | null> {
    const events = this.eventsForPlan(planId);
    return Promise.resolve(
      events.length === 0 ? null : replayPlanJournal(events, planId),
    );
  }

  loadActive(): Promise<RunRecoveryState | null> {
    const start = this.events.findLast(
      (event): event is Extract<RunJournalEvent, { type: "run_started" }> =>
        event.type === "run_started" &&
        !this.releasedRunIds.includes(event.runId),
    );
    return start === undefined
      ? Promise.resolve(null)
      : this.load(start.planId);
  }

  private eventsForPlan(planId: string): RunJournalEvent[] {
    const runIds = this.events
      .filter(
        (event) => event.type === "run_started" && event.planId === planId,
      )
      .map((event) => event.runId);
    return this.events.filter((event) => runIds.includes(event.runId));
  }

  private planIdFor(event: RunJournalEvent): string {
    if (event.type === "run_started") return event.planId;
    const start = this.events.find(
      (candidate) =>
        candidate.type === "run_started" && candidate.runId === event.runId,
    );
    if (start?.type !== "run_started") {
      throw new Error("Fake journal event has no run start");
    }
    return start.planId;
  }
}
