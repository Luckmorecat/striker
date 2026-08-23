import path from "node:path";

import type {
  ImplementationTask,
  TaskCompletionResult,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSource,
  TaskSourceAdapter,
} from "../../core/contracts.js";
import {
  parseStrikerPlan,
  type StrikerPlan,
  type StrikerPlanTask,
} from "./plan-parser.js";
import { loadImplementorWorkflow } from "./workflow-loader.js";
import { parseImplementationResult } from "../../runner/implementation-result.js";

interface AdapterOptions {
  readonly projectRoot: string;
  readonly workflowRoot: string;
}

function includesIdentity(
  completed: readonly TaskIdentity[],
  identity: TaskIdentity,
): boolean {
  return completed.some(
    (item) => item.id === identity.id && item.revision === identity.revision,
  );
}

class StrikerPlanSource implements TaskSource {
  readonly #planRoot: string;

  constructor(
    private readonly plan: StrikerPlan,
    private readonly projectRoot: string,
    private readonly workflow: string,
    planRoot: string,
  ) {
    this.#planRoot = planRoot;
  }

  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    const task = this.plan.tasks.find(
      (candidate) => !includesIdentity(completed, candidate.identity),
    );
    if (task === undefined) return Promise.resolve(null);
    return Promise.resolve(this.withExecution(task));
  }

  reconcileCompleted(
    completed: readonly TaskIdentity[],
  ): Promise<{ completed: TaskIdentity; current: TaskIdentity | null } | null> {
    for (const identity of completed) {
      const current = this.plan.tasks.find(
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
    execution?: TaskExecutionEvidence,
    agentOutput = "",
  ): Promise<TaskCompletionResult> {
    if (execution === undefined) {
      return Promise.resolve({
        attention: {
          detail: "The task has no execution evidence.",
          reason: "completion_evidence_missing",
        },
        status: "needs_attention",
      });
    }
    let result;
    try {
      result = parseImplementationResult(agentOutput);
    } catch (error) {
      return Promise.resolve({
        attention: {
          detail: error instanceof Error ? error.message : String(error),
          reason: "completion_evidence_missing",
        },
        status: "needs_attention",
      });
    }
    return Promise.resolve({
      evidence: {
        summary: result.summary,
        verification: execution.verification,
      },
      status: "completed",
    });
  }

  private withExecution(task: StrikerPlanTask): ImplementationTask {
    return {
      ...task,
      instructions: `${task.instructions}\n\n## Striker plan context\n\nPlan root: ${this.#planRoot}\nSpine: ${path.join(this.#planRoot, "spine.md")}\nMap: ${path.join(this.#planRoot, "map.md")}\n`,
      execution: {
        affectedPaths: task.affectedPaths,
        cwd: this.projectRoot,
        verifyCommand: task.verifyCommand,
        workflowInstructions: this.workflow,
      },
    };
  }
}

export class StrikerPlanAdapter implements TaskSourceAdapter {
  readonly type = "striker-plan";

  constructor(private readonly options: AdapterOptions) {}

  async open(location: string): Promise<TaskSource> {
    const planRoot = path.resolve(location);
    const [plan, workflow] = await Promise.all([
      parseStrikerPlan(planRoot),
      loadImplementorWorkflow(this.options.workflowRoot),
    ]);
    return new StrikerPlanSource(
      plan,
      this.options.projectRoot,
      workflow,
      planRoot,
    );
  }
}
