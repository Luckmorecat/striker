import type { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  ImplementationTask,
  GitState,
  GitRepository,
  RunJournal,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSource,
  TaskSourceConflict,
  Verifier,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

export interface DispatcherDependencies {
  readonly adapters: AdapterRegistry;
  readonly runner: AgentRunner;
  readonly journal: RunJournal;
  readonly git?: GitRepository;
  readonly verifier?: Verifier;
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function sameBaseline(before: GitState, after: GitState): boolean {
  return (
    before.trackedPatch === after.trackedPatch &&
    JSON.stringify(before.untrackedHashes) ===
      JSON.stringify(after.untrackedHashes)
  );
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
    const before = await this.inspectBaseline(
      task,
      request.allowDirty ?? false,
    );
    await this.ensureRunning(request.runId, task);
    const turn = await this.dependencies.runner.runInNewSession({
      instructions: task.instructions,
      skills: request.skills,
      ...(task.execution === undefined
        ? {}
        : { workflowInstructions: task.execution.workflowInstructions }),
    });
    if (turn.status === "failed") {
      return this.finishFailed(request.runId, task, turn.session, turn.error);
    }
    return this.completeReturnedTurn(
      request,
      source,
      task,
      turn.session,
      before,
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
  ): Promise<DispatchResult> {
    const execution = await this.collectExecutionEvidence(task, before);
    if (execution !== undefined && execution.verification.exitCode !== 0) {
      return this.finishNeedsAttention(
        request.runId,
        task,
        session,
        "verification_failed",
      );
    }
    if (execution !== undefined && !this.validGitEvidence(execution)) {
      return this.finishNeedsAttention(
        request.runId,
        task,
        session,
        "git_evidence_invalid",
      );
    }
    const evidence = await source.completionEvidence(task, execution);

    if (evidence === null) {
      return this.finishNeedsAttention(
        request.runId,
        task,
        session,
        "completion_evidence_missing",
      );
    }

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
    runId: string,
    task: ImplementationTask,
  ): Promise<void> {
    const recovery = await this.dependencies.journal.load(runId);
    if (recovery === null) {
      transitionRun("created", "start");
      await this.dependencies.journal.append({ runId, type: "run_started" });
    }
    await this.dependencies.journal.replace({
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
    runId: string,
    task: ImplementationTask,
    session: AgentSession,
    reason:
      | "completion_evidence_missing"
      | "git_evidence_invalid"
      | "verification_failed",
  ): Promise<DispatchResult> {
    const status = transitionRun("running", "request_attention");
    await this.dependencies.journal.append({
      runId,
      session,
      task: task.identity,
      type: "run_needs_attention",
    });
    await this.dependencies.journal.replace({ runId, session, status, task });
    return {
      reason,
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

  private async inspectBaseline(
    task: ImplementationTask,
    allowDirty: boolean,
  ): Promise<GitState | undefined> {
    const execution = task.execution;
    if (execution === undefined) return undefined;
    const git = this.dependencies.git;
    if (git === undefined)
      throw new Error("Git repository dependency is required");
    const state = await git.inspect(execution.cwd);
    if (state.dirtyPaths.length === 0) return state;
    if (!allowDirty)
      throw new Error("Repository is dirty; pass --allow-dirty to preserve it");
    const overlap = state.dirtyPaths.find((dirtyPath) =>
      execution.affectedPaths.some((taskPath) =>
        pathsOverlap(dirtyPath, taskPath),
      ),
    );
    if (overlap !== undefined) {
      throw new Error(`Task overlaps dirty path: ${overlap}`);
    }
    return state;
  }

  private async collectExecutionEvidence(
    task: ImplementationTask,
    before: GitState | undefined,
  ): Promise<TaskExecutionEvidence | undefined> {
    if (task.execution === undefined || before === undefined) return undefined;
    const git = this.dependencies.git;
    const verifier = this.dependencies.verifier;
    if (git === undefined || verifier === undefined) {
      throw new Error("Git and verifier dependencies are required");
    }
    const verification = await verifier.verify({
      command: task.execution.verifyCommand,
      cwd: task.execution.cwd,
    });
    const after = await git.inspect(task.execution.cwd);
    const commits = await git.commitsBetween(
      task.execution.cwd,
      before.head,
      after.head,
    );
    return { after, before, commits, verification };
  }

  private validGitEvidence(evidence: TaskExecutionEvidence): boolean {
    return (
      evidence.commits.length === 1 &&
      sameBaseline(evidence.before, evidence.after)
    );
  }

  private async finishFailed(
    runId: string,
    task: ImplementationTask,
    session: AgentSession,
    error: string,
  ): Promise<DispatchResult> {
    const status = transitionRun("running", "fail");
    await this.dependencies.journal.append({
      error,
      runId,
      session,
      task: task.identity,
      type: "run_failed",
    });
    await this.dependencies.journal.replace({ runId, session, status, task });
    return { error, runId, session, status: "failed", task };
  }
}
