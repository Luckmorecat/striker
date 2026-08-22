import type { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  GitRepository,
  GitState,
  ImplementationTask,
  RunAttention,
  RunJournal,
  RunRecoveryState,
  RunStatus,
  TaskSource,
} from "./contracts.js";
import { recordAttemptStart } from "./attempt-journal.js";
import { inspectBaseline } from "./dispatch-evidence.js";
import { runInFreshSession } from "./fresh-session.js";
import { transitionRun } from "./run-state.js";

interface RecoveryDependencies {
  readonly adapters: AdapterRegistry;
  readonly git?: GitRepository;
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
    attempt: number,
  ): Promise<DispatchResult>;
  continueRun(request: DispatchRequest): Promise<DispatchResult>;
  fail(
    request: DispatchRequest,
    task: ImplementationTask,
    session: AgentSession,
    error: string,
  ): Promise<DispatchResult>;
}

interface RecoverableRun {
  readonly attempt: number;
  readonly attention: RunAttention | null;
  readonly baselineRecorded: boolean;
  readonly before: GitState | undefined;
  readonly request: DispatchRequest;
  readonly session: AgentSession | null;
  readonly status: "failed" | "needs_attention" | "running";
  readonly task: ImplementationTask;
}

interface ContinuedRun extends RecoverableRun {
  readonly session: AgentSession;
}

export class PausedRunRecovery {
  constructor(
    private readonly dependencies: RecoveryDependencies,
    private readonly host: RecoveryHost,
  ) {}

  async answer(answer: string): Promise<DispatchResult> {
    if (answer.length === 0)
      throw new Error("Developer answer cannot be empty");
    const run = await this.requireRun(["needs_attention"]);
    if (run.session === null) {
      throw new Error("Paused Striker run has no session to answer");
    }
    return this.continue(
      run as ContinuedRun,
      "answer",
      `# Developer answer\n\n${answer}\n\nContinue the current task and return completion evidence.`,
      answer,
    );
  }

  async resume(): Promise<DispatchResult> {
    const recovery = await this.requireActiveRecovery();
    if (
      recovery.lastEvent.type === "task_completed" ||
      (recovery.snapshot?.status === "running" &&
        recovery.snapshot.task === null)
    ) {
      const request = recovery.snapshot?.request;
      if (request === undefined) {
        throw new Error("Completed Striker task is missing its run request");
      }
      return this.host.continueRun(request);
    }
    const run = this.recoverableRun(recovery, ["needs_attention", "running"]);
    if (run.session === null) {
      if (run.status === "needs_attention") {
        if (run.attention === null) {
          throw new Error("Paused Striker run is missing attention evidence");
        }
        return {
          reason: run.attention.reason,
          runId: run.request.runId,
          session: null,
          status: "needs_attention",
          task: run.task,
        };
      }
      return this.pauseResumeFailure(
        run,
        new Error("the interrupted attempt did not record a session"),
      );
    }
    const instructions =
      run.status === "running"
        ? "Continue the interrupted task in this preserved session and return completion evidence."
        : this.repairInstructions(run.attention);
    return this.continue(run as ContinuedRun, "resume", instructions);
  }

  async retry(): Promise<DispatchResult> {
    const recovery = await this.requireActiveRecovery();
    const run = this.recoverableRun(recovery, ["failed", "needs_attention"]);
    if (
      recovery.completedTasks.some(
        (identity) =>
          identity.id === run.task.identity.id &&
          identity.revision === run.task.identity.revision,
      )
    ) {
      throw new Error("Cannot retry a completed Striker task");
    }
    await this.dependencies.runner.preflight({ skills: run.request.skills });
    const before = run.baselineRecorded
      ? run.before
      : await inspectBaseline(
          this.dependencies,
          run.task,
          run.request.allowDirty ?? false,
        );
    transitionRun(run.status, "retry");
    await this.dependencies.journal.append({
      attempt: run.attempt,
      runId: run.request.runId,
      task: run.task.identity,
      type: "run_retried",
    });
    if (!run.baselineRecorded) {
      await this.dependencies.journal.append({
        before: before ?? null,
        runId: run.request.runId,
        task: run.task.identity,
        type: "task_baseline_recorded",
      });
    }
    const nextAttempt = run.attempt + 1;
    await recordAttemptStart(
      this.dependencies.journal,
      run.request,
      run.task,
      nextAttempt,
    );
    const turn = await runInFreshSession({
      attempt: nextAttempt,
      journal: this.dependencies.journal,
      request: run.request,
      runner: this.dependencies.runner,
      task: run.task,
    });
    if (turn.status === "needs_attention") return turn;
    if (turn.status === "failed") {
      return this.host.fail(run.request, run.task, turn.session, turn.error);
    }
    return this.checkCompletion(
      { ...run, attempt: nextAttempt, before },
      turn.session,
      turn.output,
    );
  }

  private async continue(
    paused: ContinuedRun,
    action: "answer" | "resume",
    instructions: string,
    answer?: string,
  ): Promise<DispatchResult> {
    transitionRun(paused.status, action);
    await this.appendContinuation(paused, answer);
    let turn;
    try {
      turn = await this.dependencies.runner.resumeSession(
        paused.session,
        instructions,
      );
    } catch (error) {
      return this.pauseResumeFailure({ ...paused, status: "running" }, error);
    }
    if (
      turn.session.id !== paused.session.id ||
      turn.session.resumeId !== paused.session.resumeId
    ) {
      return this.pauseResumeFailure(
        { ...paused, status: "running" },
        new Error("Agent runner replaced the paused session"),
      );
    }
    if (turn.status === "failed") {
      return this.host.fail(
        paused.request,
        paused.task,
        paused.session,
        turn.error,
      );
    }
    return this.checkCompletion(paused, paused.session, turn.output);
  }

  private async checkCompletion(
    paused: RecoverableRun,
    session: AgentSession,
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
      session,
      paused.before,
      output,
      paused.attempt,
    );
    if (result.status !== "completed") return result;
    const continued = await this.host.continueRun(paused.request);
    return continued.status === "source_exhausted" ? result : continued;
  }

  private appendContinuation(
    paused: ContinuedRun,
    answer?: string,
  ): Promise<void> {
    if (answer === undefined) {
      return this.dependencies.journal.append({
        ...(paused.attention === null ? {} : { attention: paused.attention }),
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

  private async pauseResumeFailure(
    paused: RecoverableRun,
    error: unknown,
  ): Promise<DispatchResult> {
    const message = error instanceof Error ? error.message : String(error);
    const failure = `Could not resume the preserved session: ${message}`.slice(
      0,
      1_800,
    );
    const attention: RunAttention = {
      detail: `${failure}. Run \`striker retry\` to start a fresh attempt.`,
      reason: "session_resume_failed",
    };
    transitionRun(paused.status, "request_attention");
    await this.dependencies.journal.append({
      attention,
      runId: paused.request.runId,
      session: paused.session,
      task: paused.task.identity,
      type: "run_needs_attention",
    });
    return {
      reason: attention.reason,
      runId: paused.request.runId,
      session: paused.session,
      status: "needs_attention",
      task: paused.task,
    };
  }

  private async requireActiveRecovery(): Promise<RunRecoveryState> {
    const recovery = await this.dependencies.journal.loadActive();
    if (recovery === null) throw new Error("No Striker run is active");
    return recovery;
  }

  private async requireRun(
    statuses: readonly RunStatus[],
  ): Promise<RecoverableRun> {
    return this.recoverableRun(await this.requireActiveRecovery(), statuses);
  }

  private recoverableRun(
    recovery: RunRecoveryState,
    statuses: readonly RunStatus[],
  ): RecoverableRun {
    const snapshot = recovery.snapshot;
    if (snapshot === null || !statuses.includes(snapshot.status)) {
      throw new Error("No recoverable Striker run is active");
    }
    if (snapshot.task === null) {
      throw new Error("Striker run is missing recovery context");
    }
    return {
      attempt: snapshot.attempt ?? 0,
      attention: snapshot.attention ?? null,
      baselineRecorded: snapshot.baselineRecorded ?? false,
      before: snapshot.before ?? undefined,
      request: snapshot.request,
      session: snapshot.session,
      status: snapshot.status as RecoverableRun["status"],
      task: snapshot.task,
    };
  }

  private repairInstructions(attention: RunAttention | null): string {
    if (attention === null) {
      throw new Error("Paused Striker run is missing attention evidence");
    }
    return `# Striker completion failure\n\nReason: ${attention.reason}\n\nEvidence:\n${attention.detail}\n\nRepair the task, amend its one task commit, and return completion evidence.`;
  }
}
