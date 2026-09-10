import type { RunJournal } from "./contracts.js";
import { recoveryBlocker } from "./recovery-policy.js";
import type {
  RecoveryInspection,
  ActiveRunStatus,
} from "./recovery-operations.js";

export class RunOperations {
  constructor(private readonly journal: RunJournal) {}

  async inspectRecovery(): Promise<RecoveryInspection | null> {
    const recovery = await this.journal.loadActive();
    if (recovery === null) return null;
    const { snapshot, lastEvent } = recovery;
    if (snapshot === null)
      throw new Error("Active Striker run is missing its snapshot");
    const attention =
      snapshot.attention ??
      (lastEvent.type === "run_failed"
        ? { reason: "failed", detail: lastEvent.error }
        : lastEvent.type === "run_source_changed"
          ? {
              reason: "completed_task_changed",
              detail: `Completed task ${lastEvent.task.id} changed. Restore its source or discard the run.`,
            }
          : null);
    return {
      runId: snapshot.runId,
      status: snapshot.status,
      task:
        snapshot.task === null
          ? null
          : { identity: snapshot.task.identity, title: snapshot.task.title },
      attention,
      availability: {
        answer: recoveryBlocker(recovery, "answer"),
        resume: recoveryBlocker(recovery, "resume"),
        retry: recoveryBlocker(recovery, "retry"),
      },
    };
  }

  async status(): Promise<ActiveRunStatus | null> {
    const recovery = await this.journal.loadActive();
    if (recovery === null) return null;
    const { snapshot } = recovery;
    if (snapshot === null || snapshot.status === "completed") {
      throw new Error("Active Striker run is missing nonterminal state");
    }
    const attentionReason =
      snapshot.attention?.reason ??
      (recovery.lastEvent.type === "run_source_changed"
        ? "completed_task_changed"
        : undefined);
    return {
      attempt: snapshot.attempt ?? (snapshot.task === null ? 0 : 1),
      ...(attentionReason === undefined ? {} : { attentionReason }),
      lastTransition: recovery.lastEvent.type,
      runId: snapshot.runId,
      session: snapshot.session,
      status: snapshot.status,
      task: snapshot.task?.identity ?? null,
    };
  }

  async discard(): Promise<void> {
    const recovery = await this.journal.loadActive();
    const snapshot = recovery?.snapshot;
    if (snapshot === null || snapshot === undefined) {
      throw new Error("No active Striker run to discard");
    }
    if (snapshot.status !== "failed" && snapshot.status !== "needs_attention") {
      throw new Error("Only paused or failed Striker runs can be discarded");
    }
    await this.journal.append({
      runId: snapshot.runId,
      type: "run_discarded",
    });
  }
}
