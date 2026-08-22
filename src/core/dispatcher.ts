import type { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  RunAttention,
  DispatchRequest,
  DispatchResult,
  ImplementationTask,
  GitState,
  GitRepository,
  RunJournal,
  TaskIdentity,
  TaskSource,
  TaskSourceConflict,
  Verifier,
} from "./contracts.js";
import {
  collectExecutionEvidence,
  executionAttention,
  inspectBaseline,
} from "./dispatch-evidence.js";
import {
  ensureRunStarted,
  loadCompletedTasks,
} from "./dispatch-run-lifecycle.js";
import { recordAttemptStart } from "./attempt-journal.js";
import { runInFreshSession } from "./fresh-session.js";
import { PausedRunRecovery } from "./paused-run-recovery.js";
import { transitionRun } from "./run-state.js";
import { RunOperations } from "./run-operations.js";
import { finalizeExhaustedSource } from "./source-finalization.js";
import { certifyTask, completeReviewedTask } from "./task-certification.js";

export interface DispatcherDependencies {
  readonly adapters: AdapterRegistry;
  readonly runner: AgentRunner;
  readonly journal: RunJournal;
  readonly git?: GitRepository;
  readonly verifier?: Verifier;
}

export class Dispatcher {
  constructor(private readonly dependencies: DispatcherDependencies) {}

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const completed = await loadCompletedTasks(
      this.dependencies.journal,
      request,
    );
    let latest: DispatchResult | undefined;
    let preflight = true;
    for (;;) {
      const result = await this.dispatchNext(request, completed, preflight);
      if (result.status === "source_exhausted") return latest ?? result;
      if (result.status !== "completed") return result;
      completed.push(result.task.identity);
      latest = result;
      preflight = false;
    }
  }

  async dispatchOne(request: DispatchRequest): Promise<DispatchResult> {
    const completed = await loadCompletedTasks(
      this.dependencies.journal,
      request,
    );
    const result = await this.dispatchNext(request, completed, true);
    if (result.status === "source_exhausted") return result;
    if (result.status !== "completed") return result;
    completed.push(result.task.identity);
    const next = await this.selectTask(request, completed);
    if ("conflict" in next)
      return this.finishSourceConflict(request.runId, next.conflict);
    if (next.task === null) {
      await finalizeExhaustedSource(this.dependencies.journal, request.runId);
    }
    return result;
  }

  async answer(answer: string): Promise<DispatchResult> {
    return this.recovery().answer(answer);
  }

  async resume(): Promise<DispatchResult> {
    return this.recovery().resume();
  }

  async retry(): Promise<DispatchResult> {
    return this.recovery().retry();
  }

  status() {
    return new RunOperations(this.dependencies.journal).status();
  }

  discard(): Promise<void> {
    return new RunOperations(this.dependencies.journal).discard();
  }

  private recovery(): PausedRunRecovery {
    return new PausedRunRecovery(this.dependencies, {
      complete: (...arguments_) => this.completeReturnedTurn(...arguments_),
      completeReviewed: (request, task, session, review) =>
        completeReviewedTask(
          this.dependencies.journal,
          request,
          task,
          session,
          review,
        ),
      continueRun: (request) => this.dispatch(request),
      fail: (...arguments_) => this.finishFailed(...arguments_),
    });
  }

  private async dispatchNext(
    request: DispatchRequest,
    completed: readonly TaskIdentity[],
    preflight: boolean,
  ): Promise<DispatchResult> {
    const selection = await this.selectTask(request, completed);
    if ("conflict" in selection) {
      await ensureRunStarted(this.dependencies.journal, request);
      return this.finishSourceConflict(request.runId, selection.conflict);
    }
    const { source, task } = selection;
    if (task === null) {
      await ensureRunStarted(this.dependencies.journal, request);
      await finalizeExhaustedSource(this.dependencies.journal, request.runId);
      return { runId: request.runId, status: "source_exhausted" };
    }
    if (preflight)
      await this.dependencies.runner.preflight({ skills: request.skills });
    const before = await inspectBaseline(
      this.dependencies,
      task,
      request.allowDirty ?? false,
    );
    await ensureRunStarted(this.dependencies.journal, request);
    await this.dependencies.journal.append({
      runId: request.runId,
      task,
      type: "task_selected",
    });
    await this.dependencies.journal.append({
      before: before ?? null,
      runId: request.runId,
      task: task.identity,
      type: "task_baseline_recorded",
    });
    await recordAttemptStart(this.dependencies.journal, request, task, 1);
    const turn = await runInFreshSession({
      attempt: 1,
      journal: this.dependencies.journal,
      request,
      runner: this.dependencies.runner,
      task,
    });
    if (turn.status === "needs_attention") return turn;
    if (turn.status === "failed") {
      return this.finishFailed(request, task, turn.session, turn.error);
    }
    return this.completeReturnedTurn(
      request,
      source,
      task,
      turn.session,
      before,
      turn.output,
      1,
    );
  }

  private async selectTask(
    request: DispatchRequest,
    completed: readonly TaskIdentity[],
  ): Promise<
    | { readonly source: TaskSource; readonly task: ImplementationTask | null }
    | { readonly conflict: TaskSourceConflict }
  > {
    const adapter = this.dependencies.adapters.get(request.taskSource.type);
    const source = await adapter.open(request.taskSource.location);
    const conflict = await source.reconcileCompleted(completed);
    if (conflict !== null) return { conflict };
    return { source, task: await source.nextTask(completed) };
  }

  private async completeReturnedTurn(
    request: DispatchRequest,
    source: TaskSource,
    task: ImplementationTask,
    session: AgentSession,
    before: GitState | undefined,
    agentOutput: string,
    attempt: number,
    rejectedCommit?: string,
  ): Promise<DispatchResult> {
    const execution = await collectExecutionEvidence(
      this.dependencies,
      task,
      before,
    );
    const attention = executionAttention(execution);
    if (execution?.after.head === rejectedCommit) {
      return this.finishNeedsAttention(request, task, session, {
        detail: "The standards repair did not amend the rejected candidate.",
        reason: "commit_evidence_missing",
      });
    }
    if (attention !== null) {
      return this.finishNeedsAttention(request, task, session, attention);
    }
    const completion = await source.completionEvidence(
      task,
      execution,
      agentOutput,
    );
    if (completion.status === "needs_attention") {
      return this.finishNeedsAttention(
        request,
        task,
        session,
        completion.attention,
      );
    }
    if (execution === undefined) {
      return this.finishNeedsAttention(request, task, session, {
        detail: "The task has no execution evidence.",
        reason: "completion_evidence_missing",
      });
    }

    return certifyTask(this.dependencies, {
      attempt,
      completion: completion.evidence,
      execution,
      recheck: (output, rejected) =>
        this.completeReturnedTurn(
          request,
          source,
          task,
          session,
          before,
          output,
          attempt,
          rejected,
        ),
      request,
      session,
      task,
    });
  }

  private async finishNeedsAttention(
    request: DispatchRequest,
    task: ImplementationTask,
    session: AgentSession,
    attention: RunAttention,
  ): Promise<DispatchResult> {
    const { runId } = request;
    transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      attention,
      runId,
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    return {
      reason: attention.reason,
      runId,
      session,
      status: "needs_attention",
      task,
    };
  }

  private async finishSourceConflict(
    runId: string,
    conflict: TaskSourceConflict,
  ): Promise<DispatchResult> {
    transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      current: conflict.current,
      runId,
      task: conflict.completed,
      type: "run_source_changed",
    });
    return {
      completedTask: conflict.completed,
      currentTask: conflict.current,
      reason: "completed_task_changed",
      runId,
      session: null,
      status: "needs_attention",
      task: null,
    };
  }

  private async finishFailed(
    request: DispatchRequest,
    task: ImplementationTask,
    session: AgentSession,
    error: string,
  ): Promise<DispatchResult> {
    const { runId } = request;
    transitionRun("running", "fail");
    await this.dependencies.journal.append({
      error,
      runId,
      session,
      task: task.identity,
      type: "run_failed",
    });
    return { error, runId, session, status: "failed", task };
  }
}
