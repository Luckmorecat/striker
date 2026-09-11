import path from "node:path";
import type { ActiveRunStatus } from "../core/recovery-operations.js";
import { RunOperations } from "../core/run-operations.js";
import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { readOwnedRecoveryRecord } from "../infrastructure/docker/recovery-record.js";

export async function readExecutionStatus(
  stateRoot: string,
): Promise<ActiveRunStatus | null> {
  const journal = new FileRunJournal(stateRoot);
  const operations = new RunOperations(journal);
  const status = await operations.status();
  if (!status) return null;
  const inspection = await operations.inspectRecovery();
  const recoveryActions = (["answer", "resume", "retry"] as const).filter(
    (action) => inspection?.availability[action] === null,
  );
  const descriptor = (await journal.loadActive())?.snapshot?.request.execution;
  if (!descriptor)
    return { ...status, recoveryActions, execution: { backend: "local" } };
  const execution = {
    backend: "docker" as const,
    imageId: descriptor.imageId,
    artifacts: path.resolve(stateRoot, "environments", status.runId),
  };
  try {
    const { record } = await readOwnedRecoveryRecord(
      stateRoot,
      status.runId,
      descriptor,
    );
    return {
      ...status,
      recoveryActions,
      execution: {
        ...execution,
        model: record.selection.model,
        effort: record.selection.effort,
      },
    };
  } catch {
    return {
      ...status,
      recoveryActions: [],
      execution: {
        ...execution,
        error:
          "Recorded metadata is missing, inaccessible or changed. Restore this run's environment directory and original recovery.json before continuing; inspect file access and ownership. Current defaults cannot replace recorded metadata.",
      },
    };
  }
}
