import type {
  AgentRequest,
  AgentRunner,
  AgentTurn,
  ImplementationTask,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  TaskCompletionEvidence,
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

  completionEvidence(
    task: ImplementationTask,
  ): Promise<TaskCompletionEvidence | null> {
    return Promise.resolve(this.evidence[task.identity.id] ?? null);
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
  readonly requests: AgentRequest[] = [];
  readonly #turns: AgentTurn[];

  constructor(turn: AgentTurn | readonly AgentTurn[]) {
    this.#turns = "status" in turn ? [turn] : [...turn];
  }

  runInNewSession(request: AgentRequest): Promise<AgentTurn> {
    this.lastRequest = request;
    this.requests.push(request);
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
    const events = this.events.filter((event) => event.runId === runId);
    if (events.length === 0) return Promise.resolve(null);
    return Promise.resolve({
      completedTasks: events
        .filter((event) => event.type === "task_completed")
        .map((event) => event.task),
    });
  }
}
