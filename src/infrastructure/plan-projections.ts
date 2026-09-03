import { chmod, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import type {
  DiscoveryReviewRecord,
  PlanLogReader,
  RunJournalEvent,
  RunSnapshot,
} from "../core/contracts.js";
import type { TaskOutcome } from "../core/outcome-contracts.js";
import { ledgerTransitionPause } from "../core/ledger-state.js";
import { projectDiscoveryReviewEntries } from "./discovery-review-history.js";
import { runJournalSchemaId } from "./run-journal-schema.js";

export const taskStateSchemaId = "striker.plan-task-state.v1";
export const taskOutcomesSchemaId = "striker.task-outcomes.v1";

export class FilePlanLogReader implements PlanLogReader {
  constructor(private readonly stateRoot: string) {}

  read(planId: string | null): Promise<string> {
    if (planId === null) return Promise.resolve(humanLog([]));
    if (
      !/^[A-Za-z0-9._-]+$/.test(planId) ||
      planId === "." ||
      planId === ".."
    ) {
      throw new Error("Invalid plan identity");
    }
    return readFile(
      path.join(this.stateRoot, "plans", planId, "log.md"),
      "utf8",
    );
  }
}

type CompletionEvent = Extract<
  RunJournalEvent,
  { readonly type: "task_completed" }
>;

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceFile(
  directory: string,
  name: string,
  content: string,
): Promise<void> {
  const target = path.join(directory, name);
  const temporary = path.join(directory, `${name}.${String(process.pid)}.tmp`);
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await chmod(target, 0o600);
  await syncDirectory(directory);
}

function completionRecord(
  event: CompletionEvent,
): Omit<CompletionEvent, "certification" | "type"> {
  return {
    attempt: event.attempt,
    changedPaths: event.changedPaths,
    completedAt: event.completedAt,
    resultCommit: event.resultCommit,
    runId: event.runId,
    session: event.session,
    startCommit: event.startCommit,
    task: event.task,
    verification: event.verification,
  };
}

function taskTitle(
  events: readonly RunJournalEvent[],
  completion: CompletionEvent,
): string {
  const selected = events.findLast(
    (event) =>
      event.type === "task_selected" &&
      event.runId === completion.runId &&
      event.task.identity.id === completion.task.id &&
      event.task.identity.revision === completion.task.revision,
  );
  return selected?.type === "task_selected"
    ? selected.task.title
    : completion.task.id;
}

function completionLog(
  events: readonly RunJournalEvent[],
  event: CompletionEvent,
): string {
  const paths =
    event.changedPaths.length === 0
      ? "- None"
      : event.changedPaths.map((changed) => `- \`${changed}\``).join("\n");
  return [
    `## ${taskTitle(events, event)}`,
    "",
    `Completed ${event.completedAt} in run \`${event.runId}\`, attempt ${String(event.attempt)}, session \`${event.session.id}\`.`,
    "",
    `Revision: \`${event.task.revision}\``,
    `Commits: \`${event.startCommit}\` -> \`${event.resultCommit}\``,
    `Verification: \`${event.verification.command}\` exited ${String(event.verification.exitCode)}.`,
    "",
    "Changed paths:",
    "",
    paths,
  ].join("\n");
}

function evidenceLabel(proposal: DiscoveryReviewRecord["proposal"]): string {
  const locator = proposal.locator;
  return locator.kind === "code"
    ? `Code: \`${locator.path}:${String(locator.line)}\` at \`${locator.commit}\`.`
    : `Verification: \`${locator.command}\` exited ${String(locator.exitCode)} and matched \`${locator.output}\`.`;
}

function discoveryLog(record: DiscoveryReviewRecord): string {
  const { decision, proposal, transition } = record;
  const proposalText =
    proposal.kind === "assumption"
      ? `Proposal: assumption \`${proposal.id}\` -> \`${proposal.state}\`. ${proposal.reason}`
      : `Proposal: default \`${proposal.id}\` deviation. ${proposal.deviation}`;
  const transitionText =
    transition === undefined || !record.applied
      ? "Transition: not applied."
      : `Transition: \`recorded\` -> \`${transition.state}\`.`;
  const pause =
    transition === undefined || !record.applied
      ? null
      : ledgerTransitionPause(transition, decision.reason);
  return [
    `### Discovery ${proposal.id}`,
    "",
    proposalText,
    evidenceLabel(proposal),
    `Review: ${decision.decision}. ${decision.reason}`,
    transitionText,
    ...(pause === null ? [] : [`Pause: \`${pause.reason}\`.`]),
  ].join("\n");
}

function humanLog(events: readonly RunJournalEvent[]): string {
  const discoveryEntries = projectDiscoveryReviewEntries(events);
  const records = events.flatMap((event, index) => {
    if (event.type === "task_completed") return [completionLog(events, event)];
    if (event.type !== "plan_compliance_review_completed") return [];
    return discoveryEntries
      .filter((entry) => entry.reviewIndex === index)
      .map((entry) => discoveryLog(entry.record));
  });
  return ["# Plan log", ...records.map((record) => `\n${record}`), ""].join(
    "\n",
  );
}

function formattedJson(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writePlanProjections(
  planRoot: string,
  planId: string,
  snapshot: RunSnapshot,
  events: readonly RunJournalEvent[],
  taskOutcomes: readonly TaskOutcome[],
): Promise<void> {
  const completions = events.filter(
    (event): event is CompletionEvent => event.type === "task_completed",
  );
  const writes = await Promise.allSettled([
    replaceFile(
      planRoot,
      "snapshot.json",
      formattedJson({
        eventCount: events.length,
        schema: runJournalSchemaId,
        snapshot,
      }),
    ),
    replaceFile(
      planRoot,
      "task-state.json",
      formattedJson({
        completedTasks: completions.map(completionRecord),
        planId,
        schema: taskStateSchemaId,
      }),
    ),
    replaceFile(
      planRoot,
      "task-outcomes.json",
      formattedJson({
        outcomes: taskOutcomes,
        planId,
        schema: taskOutcomesSchemaId,
      }),
    ),
    replaceFile(planRoot, "log.md", humanLog(events)),
  ]);
  const failure = writes.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure !== undefined) throw failure.reason;
}
