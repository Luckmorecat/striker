import type {
  RunJournal,
  RunJournalEvent,
  RunSnapshot,
  TaskIdentity,
} from "./contracts.js";

export interface CertifiedExport {
  readonly branch: string;
  readonly runId: string;
  readonly previousHead: string | null;
  readonly startCommit: string;
  readonly resultCommit: string;
}
export interface ResultExporter {
  export(intent: CertifiedExport): Promise<void>;
}
export interface ResultExportState {
  readonly branch: string;
  readonly head: string | null;
  readonly error: string | null;
  readonly pending: {
    readonly task: TaskIdentity;
    readonly startCommit: string;
    readonly resultCommit: string;
  } | null;
}
export type ResultExportEvent =
  | {
      readonly type: "result_export_completed";
      readonly runId: string;
      readonly head: string;
    }
  | {
      readonly type: "result_export_failed";
      readonly runId: string;
      readonly head: string;
      readonly error: string;
    };
export function resultBranchName(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId))
    throw new Error("Invalid result branch run identity");
  return `codex/striker-${runId}`;
}
export function queueCertifiedExport(
  snapshot: RunSnapshot,
  event: Extract<RunJournalEvent, { type: "task_completed" }>,
): ResultExportState | undefined {
  const state = snapshot.resultExport;
  if (!state) return undefined;
  if (
    state.pending ||
    event.certification !== "independent_reviews" ||
    event.verification.exitCode !== 0 ||
    event.startCommit !== (state.head ?? snapshot.request.execution?.sourceHead)
  )
    throw new Error(
      "Result export requires contiguous independently certified task commits",
    );
  return {
    ...state,
    error: null,
    pending: {
      task: event.task,
      startCommit: event.startCommit,
      resultCommit: event.resultCommit,
    },
  };
}
export function replayResultExport(
  snapshot: RunSnapshot,
  event: ResultExportEvent,
): RunSnapshot {
  const state = snapshot.resultExport;
  if (
    state?.pending?.resultCommit !== event.head ||
    snapshot.task !== null ||
    !["running", "needs_attention"].includes(snapshot.status)
  )
    throw new Error(
      "Result export event does not match pending certified completion",
    );
  return {
    ...snapshot,
    resultExport:
      event.type === "result_export_failed"
        ? { ...state, error: event.error }
        : { ...state, head: event.head, pending: null, error: null },
  };
}
export async function flushResultExport(
  journal: RunJournal,
  exporter?: ResultExporter,
  runId?: string,
): Promise<void> {
  const snapshot = (await journal.loadActive())?.snapshot;
  const state = snapshot?.resultExport;
  if (!snapshot || !state?.pending) return;
  if (runId !== undefined && runId !== snapshot.runId)
    throw new Error("Another Striker run owns the pending export");
  const head = state.pending.resultCommit;
  try {
    if (!exporter)
      throw new Error("Execution environment has no result exporter");
    await exporter.export({
      branch: state.branch,
      runId: snapshot.runId,
      previousHead: state.head,
      startCommit: state.pending.startCommit,
      resultCommit: head,
    });
  } catch (cause) {
    const error = `Result export to ${state.branch} failed: ${cause instanceof Error ? cause.message : String(cause)}. Exported head: ${state.head ?? "none"}. Restore the result branch and run striker resume; the certified task will not rerun.`;
    await journal.append({
      type: "result_export_failed",
      runId: snapshot.runId,
      head,
      error,
    });
    throw new Error(error, { cause });
  }
  await journal.append({
    type: "result_export_completed",
    runId: snapshot.runId,
    head,
  });
}
/** Certification remains the single trigger, including review/discovery recovery. */
export function exportingJournal(
  journal: RunJournal,
  exporter?: ResultExporter,
): RunJournal {
  return {
    load: (planId) => journal.load(planId),
    loadActive: () => journal.loadActive(),
    append: async (event) => {
      if (event.type === "task_selected" || event.type === "run_completed")
        await flushResultExport(journal, exporter, event.runId);
      await journal.append(event);
      if (event.type === "task_completed")
        await flushResultExport(journal, exporter, event.runId);
    },
  };
}
