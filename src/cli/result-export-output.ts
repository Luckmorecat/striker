import type { ResultExportState } from "../core/result-export.js";
import type { DispatchResult, RunJournal } from "../core/contracts.js";
export function resultExportLines(state: ResultExportState): string[] {
  return [
    `Result branch: ${state.branch}`,
    `Exported head: ${state.head ?? "none"}`,
    ...(state.pending ? [`Pending export: ${state.pending.resultCommit}`] : []),
    ...(state.error ? [`Export error: ${state.error}`] : []),
  ];
}
export async function withResultExport(
  result: DispatchResult,
  journal: RunJournal,
  planId: string,
): Promise<DispatchResult> {
  const state = (await journal.load(planId))?.snapshot?.resultExport;
  return state ? { ...result, resultExport: state } : result;
}
