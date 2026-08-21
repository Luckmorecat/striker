import { stat } from "node:fs/promises";
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
  appendCompletionMarker,
  readCompletionMarkers,
} from "./completion-marker.js";
import {
  parseStrikerPlan,
  type StrikerPlan,
  type StrikerPlanTask,
} from "./plan-parser.js";
import { loadImplementorWorkflow } from "./workflow-loader.js";
import {
  hasReviewEvidence,
  reviewEvidenceInstructions,
} from "./review-evidence.js";

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

function inRepositorySupportPaths(
  projectRoot: string,
  planRoot: string,
): string[] {
  const relative = path.relative(projectRoot, planRoot);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return [];
  }
  const planPath = relative.split(path.sep).join("/");
  return ["spine.md", "map.md", "log.md"].map((file) =>
    path.posix.join(planPath, file),
  );
}

class StrikerPlanSource implements TaskSource {
  readonly #logPath: string;
  readonly #planRoot: string;

  constructor(
    private readonly plan: StrikerPlan,
    private readonly projectRoot: string,
    private readonly workflow: string,
    planRoot: string,
  ) {
    this.#planRoot = planRoot;
    this.#logPath = path.join(planRoot, "log.md");
  }

  async nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null> {
    const markers = await readCompletionMarkers(this.#logPath);
    const task = this.plan.tasks.find(
      (candidate) =>
        !includesIdentity(completed, candidate.identity) &&
        !includesIdentity(markers, candidate.identity),
    );
    if (task === undefined) return null;
    const logSizeBefore = (await stat(this.#logPath)).size;
    return this.withExecution(task, logSizeBefore);
  }

  async reconcileCompleted(
    completed: readonly TaskIdentity[],
  ): Promise<{ completed: TaskIdentity; current: TaskIdentity | null } | null> {
    for (const identity of completed) {
      const current = this.plan.tasks.find(
        (task) => task.identity.id === identity.id,
      );
      if (current === undefined) return { completed: identity, current: null };
      if (current.identity.revision !== identity.revision) {
        return { completed: identity, current: current.identity };
      }
    }
    for (const identity of completed) {
      await appendCompletionMarker(this.#logPath, identity);
    }
    return null;
  }

  async completionEvidence(
    task: ImplementationTask,
    execution?: TaskExecutionEvidence,
    agentOutput = "",
  ): Promise<TaskCompletionResult> {
    if (execution === undefined) {
      return {
        attention: {
          detail: "The task has no execution evidence.",
          reason: "completion_evidence_missing",
        },
        status: "needs_attention",
      };
    }
    const logSizeAfter = (await stat(this.#logPath)).size;
    const logSizeBefore = Number(task.completionToken ?? "0");
    if (logSizeAfter <= logSizeBefore) {
      return {
        attention: {
          detail:
            "The implementor did not append the required human plan log entry.",
          reason: "human_log_missing",
        },
        status: "needs_attention",
      };
    }
    if (!hasReviewEvidence(agentOutput)) {
      return {
        attention: {
          detail: "The implementor did not report both required review passes.",
          reason: "review_evidence_missing",
        },
        status: "needs_attention",
      };
    }
    return {
      evidence: {
        summary: `${task.title} passed Git, log, reviews, and verification evidence`,
        verification: execution.verification,
      },
      status: "completed",
    };
  }

  async markCompleted(task: ImplementationTask): Promise<void> {
    await appendCompletionMarker(this.#logPath, task.identity);
  }

  private withExecution(
    task: StrikerPlanTask,
    logSizeBefore: number,
  ): ImplementationTask {
    return {
      ...task,
      completionToken: String(logSizeBefore),
      instructions: `${task.instructions}\n\n## Striker plan context\n\nPlan root: ${this.#planRoot}\nSpine: ${path.join(this.#planRoot, "spine.md")}\nMap: ${path.join(this.#planRoot, "map.md")}\nLog: ${this.#logPath}\n`,
      execution: {
        affectedPaths: [
          ...task.affectedPaths,
          ...inRepositorySupportPaths(this.projectRoot, this.#planRoot),
        ],
        cwd: this.projectRoot,
        verifyCommand: task.verifyCommand,
        workflowInstructions: `${this.workflow}\n\n${reviewEvidenceInstructions}`,
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
