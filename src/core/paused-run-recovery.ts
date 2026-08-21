import type { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitState,
  ImplementationTask,
  RunAttention,
  RunJournal,
  TaskSource,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

interface RecoveryDependencies {
  readonly adapters: AdapterRegistry;
  readonly journal: RunJournal;
  readonly runner: AgentRunner;
}

interface RecoveryHost {
  complete(
    request: DispatchRequest,
    source: TaskSource,
    task: ImplementationTask,
    session: AgentSession,
    before: GitState | undefined,
    output: string,
  ): Promise<DispatchResult>;
  continueRun(request: DispatchRequest): Promise<DispatchResult>;
  fail(
    request: DispatchRequest,
    task: ImplementationTask,
    session: AgentSession,
    error: string,
    before: GitState | undefined,
  ): Promise<DispatchResult>;
}

interface PausedRun {
  readonly attention: RunAttention;
  readonly before: GitState | undefined;
  readonly request: DispatchRequest;
  readonly session: AgentSession;
  readonly task: ImplementationTask;
}

export class PausedRunRecovery {
  constructor(
    private readonly dependencies: RecoveryDependencies,
    private readonly host: RecoveryHost,
  ) {}

  async answer(answer: string): Promise<DispatchResult> {
    if (answer.length === 0)
      throw new Error("Developer answer cannot be empty");
    return this.continue(
      "answer",
      `# Developer answer\n\n${answer}\n\nContinue the current task and return completion evidence.`,
      answer,
    );
  }

  async resume(): Promise<DispatchResult> {
    const { attention } = await this.requirePausedRun();
    return this.continue(
      "resume",
      `# Striker completion failure\n\nReason: ${attention.reason}\n\nEvidence:\n${attention.detail}\n\nRepair the task, amend its one task commit, and return completion evidence.`,
    );
  }

  private async continue(
    action: "answer" | "resume",
    instructions: string,
    answer?: string,
  ): Promise<DispatchResult> {
    const paused = await this.requirePausedRun();
    transitionRun("needs_attention", action);
    await this.appendContinuation(paused, answer);
    await this.markRunning(paused);
    let turn;
    try {
      turn = await this.dependencies.runner.resumeSession(
        paused.session,
        instructions,
      );
    } catch (error) {
      return this.pauseResumeFailure(paused, error);
    }
    if (
      turn.session.id !== paused.session.id ||
      turn.session.resumeId !== paused.session.resumeId
    ) {
      return this.pauseResumeFailure(
        paused,
        new Error("Agent runner replaced the paused session"),
      );
    }
    if (turn.status === "failed") {
      return this.host.fail(
        paused.request,
        paused.task,
        paused.session,
        turn.error,
        paused.before,
      );
    }
    return this.checkCompletion(paused, turn.output);
  }

  private async checkCompletion(
    paused: PausedRun,
    output: string,
  ): Promise<DispatchResult> {
    const adapter = this.dependencies.adapters.get(
      paused.request.taskSource.type,
    );
    const source = await adapter.open(paused.request.taskSource.location);
    const result = await this.host.complete(
      paused.request,
      source,
      paused.task,
      paused.session,
      paused.before,
      output,
    );
    if (result.status !== "completed") return result;
    const continued = await this.host.continueRun(paused.request);
    return continued.status === "source_exhausted" ? result : continued;
  }

  private appendContinuation(
    paused: PausedRun,
    answer?: string,
  ): Promise<void> {
    if (answer === undefined) {
      return this.dependencies.journal.append({
        attention: paused.attention,
        runId: paused.request.runId,
        session: paused.session,
        task: paused.task.identity,
        type: "run_resumed",
      });
    }
    return this.dependencies.journal.append({
      answer,
      runId: paused.request.runId,
      session: paused.session,
      task: paused.task.identity,
      type: "run_answered",
    });
  }

  private markRunning(paused: PausedRun): Promise<void> {
    return this.dependencies.journal.replace({
      attention: null,
      before: paused.before ?? null,
      request: paused.request,
      runId: paused.request.runId,
      session: paused.session,
      status: "running",
      task: paused.task,
    });
  }

  private async pauseResumeFailure(
    paused: PausedRun,
    error: unknown,
  ): Promise<DispatchResult> {
    const message = error instanceof Error ? error.message : String(error);
    const attention: RunAttention = {
      detail: `Could not resume the preserved session: ${message}`.slice(
        0,
        2_000,
      ),
      reason: "session_resume_failed",
    };
    transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      attention,
      runId: paused.request.runId,
      session: paused.session,
      task: paused.task.identity,
      type: "run_needs_attention",
    });
    await this.dependencies.journal.replace({
      attention,
      before: paused.before ?? null,
      request: paused.request,
      runId: paused.request.runId,
      session: paused.session,
      status: "needs_attention",
      task: paused.task,
    });
    return {
      reason: attention.reason,
      runId: paused.request.runId,
      session: paused.session,
      status: "needs_attention",
      task: paused.task,
    };
  }

  private async requirePausedRun(): Promise<PausedRun> {
    const recovery = await this.dependencies.journal.loadActive();
    const snapshot = recovery?.snapshot;
    if (snapshot?.status !== "needs_attention") {
      throw new Error("No paused Striker run is active");
    }
    if (
      snapshot.attention == null ||
      snapshot.request === undefined ||
      snapshot.session === null ||
      snapshot.task === null
    ) {
      throw new Error("Paused Striker run is missing recovery context");
    }
    return {
      attention: snapshot.attention,
      before: snapshot.before ?? undefined,
      request: snapshot.request,
      session: snapshot.session,
      task: snapshot.task,
    };
  }
}
