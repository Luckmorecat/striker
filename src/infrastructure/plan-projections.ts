import { chmod, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import type {
  PlanLogReader,
  RunJournalEvent,
  RunSnapshot,
} from "../core/contracts.js";
import { runJournalSchemaId } from "./run-journal-schema.js";

export const taskStateSchemaId = "striker.plan-task-state.v1";

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

function humanLog(events: readonly RunJournalEvent[]): string {
  const records = events
    .filter(
      (event): event is CompletionEvent => event.type === "task_completed",
    )
    .map((event) => completionLog(events, event));
  return ["# Plan log", ...records.map((record) => `\n${record}`), ""].join(
    "\n",
  );
}

export async function writePlanProjections(
  planRoot: string,
  planId: string,
  snapshot: RunSnapshot,
  events: readonly RunJournalEvent[],
): Promise<void> {
  const completions = events.filter(
    (event): event is CompletionEvent => event.type === "task_completed",
  );
  await replaceFile(
    planRoot,
    "snapshot.json",
    `${JSON.stringify(
      {
        eventCount: events.length,
        schema: runJournalSchemaId,
        snapshot,
      },
      null,
      2,
    )}\n`,
  );
  await replaceFile(
    planRoot,
    "task-state.json",
    `${JSON.stringify(
      {
        completedTasks: completions.map(completionRecord),
        planId,
        schema: taskStateSchemaId,
      },
      null,
      2,
    )}\n`,
  );
  await replaceFile(planRoot, "log.md", humanLog(events));
}
