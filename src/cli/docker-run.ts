import { randomUUID } from "node:crypto";
import path from "node:path";
import { AdapterRegistry } from "../core/adapter-registry.js";
import { Dispatcher } from "../core/dispatcher.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { openDockerExecution } from "../infrastructure/docker/open-execution.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";

export async function dispatchDockerRun(
  options: Omit<Parameters<typeof openDockerExecution>[0], "runId"> & {
    readonly source: string;
    readonly allowDirty: boolean;
  },
) {
  if (options.allowDirty)
    throw new Error("--allow-dirty is available only for local execution");
  const journal = new FileRunJournal(options.stateRoot);
  if (await journal.loadActive())
    throw new Error("Another Striker run is active");
  const plan = await parseStrikerPlan(options.source);
  const runId = randomUUID();
  const execution = await openDockerExecution({ ...options, runId });
  try {
    const adapters = new AdapterRegistry();
    adapters.register(
      new StrikerPlanAdapter({
        projectRoot: options.projectRoot,
        workflowRoot: path.join(options.packagedRoot, "striker-implementor"),
        inlineContext: true,
      }),
    );
    return await new Dispatcher({
      adapters,
      journal,
      ...execution.services,
    }).dispatch({
      runId,
      planId: plan.identity,
      skills: options.config.skills,
      completedTasks: [],
      taskSource: { type: options.config.taskSource, location: options.source },
      execution: {
        backend: "docker",
        environmentId: execution.environment.environmentId,
        imageId: execution.environment.imageId,
        sourceHead: execution.source.head,
        sourceBranch: execution.source.branch,
      },
    });
  } finally {
    await execution.close();
  }
}
