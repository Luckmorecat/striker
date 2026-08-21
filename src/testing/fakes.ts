import type {
  AgentRequest,
  AgentRunner,
  AgentTurn,
  ImplementationTask,
  RunJournal,
  RunJournalEvent,
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

  constructor(private readonly turn: AgentTurn) {}

  runInNewSession(request: AgentRequest): Promise<AgentTurn> {
    this.lastRequest = request;
    return Promise.resolve(this.turn);
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
}
