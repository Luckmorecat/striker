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
  TaskCompletionEvidence,
  TaskCompletionResult,
  TaskIdentity,
  TaskSource,
  TaskSourceAdapter,
} from "../core/contracts.js";

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
  readonly resumeRequests: {
    readonly instructions: string;
    readonly session: AgentSession;
  }[] = [];
  readonly #turns: AgentTurn[];

  constructor(turn: AgentTurn | readonly AgentTurn[]) {
    this.#turns = "status" in turn ? [turn] : [...turn];
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
}

export class InMemoryRunJournal implements RunJournal {
  readonly deletedRunIds: string[] = [];
  readonly events: RunJournalEvent[] = [];
  readonly snapshots: RunSnapshot[] = [];

  append(event: RunJournalEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  replace(snapshot: RunSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }

  delete(runId: string): Promise<void> {
    this.deletedRunIds.push(runId);
    return Promise.resolve();
  }

  load(runId: string): Promise<RunRecoveryState | null> {
    if (this.deletedRunIds.includes(runId)) return Promise.resolve(null);
    const events = this.events.filter((event) => event.runId === runId);
    if (events.length === 0) return Promise.resolve(null);
    const lastEvent = events.at(-1);
    if (lastEvent === undefined) throw new Error("Missing fake journal event");
    return Promise.resolve({
      completedTasks: events
        .filter((event) => event.type === "task_completed")
        .map((event) => event.task),
      lastEvent,
      snapshot:
        this.snapshots.filter((item) => item.runId === runId).at(-1) ?? null,
    });
  }

  loadActive(): Promise<RunRecoveryState | null> {
    const runId = this.events.find(
      (event) =>
        event.type === "run_started" &&
        !this.deletedRunIds.includes(event.runId),
    )?.runId;
    return runId === undefined ? Promise.resolve(null) : this.load(runId);
  }
}
