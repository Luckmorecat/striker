import type { AdapterRegistry } from "./adapter-registry.js";
import type {
  AgentRunner,
  AgentSession,
  DispatchRequest,
  DispatchResult,
  ImplementationTask,
  RunJournal,
} from "./contracts.js";
import { transitionRun } from "./run-state.js";

export interface DispatcherDependencies {
  readonly adapters: AdapterRegistry;
  readonly runner: AgentRunner;
  readonly journal: RunJournal;
}

export class Dispatcher {
  constructor(private readonly dependencies: DispatcherDependencies) {}

  async dispatchOne(request: DispatchRequest): Promise<DispatchResult> {
    const adapter = this.dependencies.adapters.get(request.taskSource.type);
    const source = await adapter.open(request.taskSource.location);
    const task = await source.nextTask(request.completedTasks);

    if (task === null) {
      return { runId: request.runId, status: "source_exhausted" };
    }

    const running = transitionRun("created", "start");
    await this.dependencies.journal.append({
      runId: request.runId,
      type: "run_started",
    });
    await this.dependencies.journal.replace({
      runId: request.runId,
      session: null,
      status: running,
      task,
    });

    const turn = await this.dependencies.runner.runInNewSession({
      instructions: task.instructions,
      skills: request.skills,
    });

    if (turn.status === "failed") {
      return this.finishFailed(request.runId, task, turn.session, turn.error);
    }

    const evidence = await source.completionEvidence(task);

    if (evidence === null) {
      return this.finishNeedsAttention(request.runId, task, turn.session);
    }

    transitionRun(running, "complete");
    await this.dependencies.journal.append({
      runId: request.runId,
      session: turn.session,
      task: task.identity,
      type: "task_completed",
    });
    await this.dependencies.journal.delete(request.runId);

    return {
      evidence,
      runId: request.runId,
      session: turn.session,
      status: "completed",
      task,
    };
  }

  private async finishNeedsAttention(
    runId: string,
    task: ImplementationTask,
    session: AgentSession,
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
      reason: "completion_evidence_missing",
      runId,
      session,
      status: "needs_attention",
      task,
    };
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
