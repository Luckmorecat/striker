import { resolveModelSelection } from "../config/project-config.js";
import { resultBranchName } from "../core/result-export.js";
import { withResultExport } from "./result-export-output.js";
import { acquireProjectOperation } from "../infrastructure/project-operation-lease.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AdapterRegistry } from "../core/adapter-registry.js";
import { Dispatcher } from "../core/dispatcher.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { openDockerExecution } from "../infrastructure/docker/open-execution.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";

async function dispatchOwnedRun(
  options: Omit<Parameters<typeof openDockerExecution>[0], "runId" | "plan"> & {
    readonly source: string;
    readonly allowDirty: boolean;
    readonly writeOut?: (text: string) => unknown;
  },
) {
  if (options.allowDirty)
    throw new Error("--allow-dirty is available only for local execution");
  const journal = new FileRunJournal(options.stateRoot);
  if (await journal.loadActive())
    throw new Error("Another Striker run is active");
  const plan = await parseStrikerPlan(options.source);
  const runId = randomUUID();
  const binding = {
    identity: plan.identity,
    manifest: JSON.stringify(plan.manifest),
  };
  const execution = await openDockerExecution({
    ...options,
    runId,
    plan: binding,
  });
  try {
    printEnvironment(options, runId, execution.environment);
    const adapters = new AdapterRegistry();
    adapters.register(
      new StrikerPlanAdapter({
        projectRoot: options.projectRoot,
        workflowRoot: path.join(options.packagedRoot, "striker-implementor"),
        inlineContext: true,
        planBinding: binding,
      }),
    );
    const result = await new Dispatcher({
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
        recoveryId: execution.recoveryId,
        environmentId: execution.environment.environmentId,
        imageId: execution.environment.imageId,
        sourceHead: execution.source.head,
        sourceRoot: options.projectRoot,
        sourceBranch: execution.source.branch,
      },
    });
    return await withResultExport(result, journal, plan.identity);
  } finally {
    await execution.close();
  }
}

export async function dispatchDockerRun(
  options: Parameters<typeof dispatchOwnedRun>[0],
) {
  const release = await acquireProjectOperation(options.stateRoot);
  try {
    return await dispatchOwnedRun(options);
  } finally {
    await release();
  }
}

function printEnvironment(
  options: Parameters<typeof dispatchOwnedRun>[0],
  runId: string,
  environment: import("../core/environment-preparation.js").RetainedFeatureEnvironment,
) {
  const selection = resolveModelSelection(options.config);
  options.writeOut?.(
    [
      `Run: ${runId}`,
      `Image: ${environment.imageId}`,
      `Model: ${selection.model} (${selection.effort})`,
      `Artifacts: ${path.dirname(environment.checkout)}`,
      `Result branch: ${resultBranchName(runId)} (after certification)`,
      "Inspect pauses with striker status; use its available recovery actions.",
      "",
    ].join("\n"),
  );
}
