import { ExecutionResourceAttention } from "../infrastructure/docker/resource-attention.js";
import type { RunSnapshot } from "../core/contracts.js";
import path from "node:path";
import { AdapterRegistry } from "../core/adapter-registry.js";
import { Dispatcher } from "../core/dispatcher.js";
import { validateRecovery } from "../core/recovery-policy.js";
import { StrikerPlanAdapter } from "../adapters/striker-plan/striker-plan-adapter.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { reopenDockerExecution } from "../infrastructure/docker/reopen-execution.js";
import { acquireProjectOperation } from "../infrastructure/project-operation-lease.js";

export async function recoverDockerRun(options: {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly action: "resume" | "retry" | "answer";
  readonly answer?: string;
}) {
  const release = await acquireProjectOperation(options.stateRoot);
  try {
    const journal = new FileRunJournal(options.stateRoot);
    const recovery = await journal.loadActive();
    const snapshot = recovery?.snapshot;
    const descriptor = snapshot?.request.execution;
    if (!recovery || !snapshot || !descriptor)
      throw new Error("No Docker run is active");
    validateRecovery(recovery, options.action);
    const execution = await reopenOrRecordAttention(journal, snapshot, {
      ...options,
      runId: snapshot.runId,
      descriptor,
      retry: options.action === "retry",
    });
    try {
      const adapters = new AdapterRegistry();
      adapters.register(
        new StrikerPlanAdapter({
          projectRoot: options.projectRoot,
          workflowRoot: path.join(
            execution.record.environment.inputs,
            "skills/striker-implementor",
          ),
          inlineContext: true,
          planBinding: execution.record.plan,
        }),
      );
      const dispatcher = new Dispatcher({
        adapters,
        journal,
        ...execution.services,
      });
      return options.action === "answer"
        ? await dispatcher.answer(options.answer ?? "")
        : await dispatcher[options.action]();
    } finally {
      await execution.close();
    }
  } finally {
    await release();
  }
}

async function reopenOrRecordAttention(
  journal: FileRunJournal,
  snapshot: RunSnapshot,
  options: Parameters<typeof reopenDockerExecution>[0],
) {
  try {
    return await reopenDockerExecution(options);
  } catch (error) {
    if (error instanceof ExecutionResourceAttention && snapshot.task)
      await journal.append({
        type: "run_needs_attention",
        runId: snapshot.runId,
        task: snapshot.task.identity,
        session: snapshot.session,
        attention: {
          reason: "execution_resource_exhausted",
          detail: error.message,
        },
      });
    throw error;
  }
}
