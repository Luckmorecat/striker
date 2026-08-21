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
import { PausedRunRecovery } from "./paused-run-recovery.js";
import { transitionRun } from "./run-state.js";

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
    const completed = await this.completedTasks(request);
    let latest: DispatchResult | undefined;
    let preflight = true;
    for (;;) {
      const result = await this.dispatchNext(request, completed, preflight);
      if (result.status === "source_exhausted") {
        await this.finishRun(request.runId);
        return latest ?? result;
      }
      if (result.status !== "completed") return result;
      completed.push(result.task.identity);
      latest = result;
      preflight = false;
    }
  }

  async dispatchOne(request: DispatchRequest): Promise<DispatchResult> {
    const completed = await this.completedTasks(request);
    const result = await this.dispatchNext(request, completed, true);
    if (result.status === "source_exhausted") {
      await this.finishRun(request.runId);
      return result;
    }
    if (result.status !== "completed") return result;
    completed.push(result.task.identity);
    const next = await this.selectTask(request, completed);
    if ("conflict" in next) {
      return this.finishSourceConflict(request.runId, next.conflict);
    }
    if (next.task === null) await this.finishRun(request.runId);
    return result;
  }

  async answer(answer: string): Promise<DispatchResult> {
    return this.recovery().answer(answer);
  }

  async resume(): Promise<DispatchResult> {
    return this.recovery().resume();
  }

  private recovery(): PausedRunRecovery {
    return new PausedRunRecovery(this.dependencies, {
      complete: (...arguments_) => this.completeReturnedTurn(...arguments_),
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
      return this.finishSourceConflict(request.runId, selection.conflict);
    }
    const { source, task } = selection;
    if (task === null) {
      return { runId: request.runId, status: "source_exhausted" };
    }
    if (preflight) {
      await this.dependencies.runner.preflight({ skills: request.skills });
    }
    const before = await inspectBaseline(
      this.dependencies,
      task,
      request.allowDirty ?? false,
    );
    await this.ensureRunning(request, task, before);
    const turn = await this.dependencies.runner.runInNewSession({
      instructions: task.instructions,
      skills: request.skills,
      ...(task.execution === undefined
        ? {}
        : { workflowInstructions: task.execution.workflowInstructions }),
    });
    if (turn.status === "failed") {
      return this.finishFailed(request, task, turn.session, turn.error, before);
    }
    return this.completeReturnedTurn(
      request,
      source,
      task,
      turn.session,
      before,
      turn.output,
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
  ): Promise<DispatchResult> {
    const execution = await collectExecutionEvidence(
      this.dependencies,
      task,
      before,
    );
    const attention = executionAttention(execution);
    if (attention !== null) {
      return this.finishNeedsAttention(
        request,
        task,
        session,
        attention,
        before,
      );
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
        before,
      );
    }
    const { evidence } = completion;

    transitionRun("running", "complete_task");
    await this.dependencies.journal.append({
      runId: request.runId,
      session,
      task: task.identity,
      type: "task_completed",
      evidence,
      ...(execution === undefined ? {} : { execution }),
    });
    await source.markCompleted?.(task, evidence);

    return {
      evidence,
      runId: request.runId,
      session,
      status: "completed",
      task,
    };
  }

  private async completedTasks(
    request: DispatchRequest,
  ): Promise<TaskIdentity[]> {
    const completed = [...request.completedTasks];
    const recovery = await this.dependencies.journal.load(request.runId);
    for (const identity of recovery?.completedTasks ?? []) {
      const known = completed.some(
        (item) =>
          item.id === identity.id && item.revision === identity.revision,
      );
      if (!known) completed.push(identity);
    }
    return completed;
  }

  private async ensureRunning(
    request: DispatchRequest,
    task: ImplementationTask,
    before: GitState | undefined,
  ): Promise<void> {
    const { runId } = request;
    const recovery = await this.dependencies.journal.load(runId);
    if (recovery === null) {
      transitionRun("created", "start");
      await this.dependencies.journal.append({ runId, type: "run_started" });
    }
    await this.dependencies.journal.replace({
      attention: null,
      before: before ?? null,
      request,
      runId,
      session: null,
      status: "running",
      task,
    });
  }

  private async finishRun(runId: string): Promise<void> {
    if ((await this.dependencies.journal.load(runId)) === null) return;
    transitionRun("running", "complete");
    await this.dependencies.journal.delete(runId);
  }

  private async finishNeedsAttention(
    request: DispatchRequest,
    task: ImplementationTask,
    session: AgentSession,
    attention: RunAttention,
    before: GitState | undefined,
  ): Promise<DispatchResult> {
    const { runId } = request;
    const status = transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      attention,
      runId,
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    await this.dependencies.journal.replace({
      attention,
      before: before ?? null,
      request,
      runId,
      session,
      status,
      task,
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
    if ((await this.dependencies.journal.load(runId)) === null) {
      transitionRun("created", "start");
      await this.dependencies.journal.append({ runId, type: "run_started" });
    }
    const status = transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      current: conflict.current,
      runId,
      task: conflict.completed,
      type: "run_source_changed",
    });
    await this.dependencies.journal.replace({
      runId,
      session: null,
      status,
      task: null,
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
    before: GitState | undefined,
  ): Promise<DispatchResult> {
    const { runId } = request;
    const status = transitionRun("running", "fail");
    await this.dependencies.journal.append({
      error,
      runId,
      session,
      task: task.identity,
      type: "run_failed",
    });
    await this.dependencies.journal.replace({
      attention: null,
      before: before ?? null,
      request,
      runId,
      session,
      status,
      task,
    });
    return { error, runId, session, status: "failed", task };
  }
}
