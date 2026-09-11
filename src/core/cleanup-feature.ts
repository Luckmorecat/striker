import type { RunSnapshot } from "./contracts.js";

export type CleanupState = "started" | "completed";
export type CleanupEvent =
  | { readonly type: "cleanup_started"; readonly runId: string }
  | { readonly type: "cleanup_completed"; readonly runId: string };
export interface FeatureResources {
  remove(snapshot: RunSnapshot): Promise<void>;
}
export interface ExecutionStopper {
  stop(snapshot: RunSnapshot): Promise<void>;
}
export interface CleanupFeatureHandler {
  cleanup(runId: string): Promise<void>;
}
interface CleanupJournal {
  loadRun(runId: string): Promise<RunSnapshot | null>;
  append(event: CleanupEvent): Promise<void>;
}
export function assertCleanupEligible(snapshot: RunSnapshot): void {
  if (snapshot.status === "running" || snapshot.status === "created")
    throw new Error(
      "Cannot clean up a running feature; stop and discard it first",
    );
  if (!snapshot.request.execution)
    throw new Error("This run has no owned isolated execution resources");
}
export function replayCleanup(
  snapshot: RunSnapshot,
  event: CleanupEvent,
): RunSnapshot {
  assertCleanupEligible(snapshot);
  if (event.type === "cleanup_completed" && !snapshot.cleanup)
    throw new Error("Cleanup completion requires durable intent");
  if (event.type === "cleanup_started" && snapshot.cleanup)
    throw new Error("Cleanup already has durable intent");
  return {
    ...snapshot,
    cleanup: event.type === "cleanup_started" ? "started" : "completed",
  };
}
export class CleanupFeature implements CleanupFeatureHandler {
  constructor(
    private readonly journal: CleanupJournal,
    private readonly resources: FeatureResources,
  ) {}
  async cleanup(runId: string): Promise<void> {
    const snapshot = await this.journal.loadRun(runId);
    if (!snapshot)
      throw new Error(`No recorded Striker run ${runId} in this repository`);
    assertCleanupEligible(snapshot);
    if (snapshot.cleanup === "completed") return;
    if (!snapshot.cleanup)
      await this.journal.append({ type: "cleanup_started", runId });
    await this.resources.remove(snapshot);
    await this.journal.append({ type: "cleanup_completed", runId });
  }
}

export function isCleanupEvent(event: {
  readonly type: string;
}): event is CleanupEvent {
  return event.type === "cleanup_started" || event.type === "cleanup_completed";
}
export function assertExecutionRetained(
  snapshot: RunSnapshot,
  event: { readonly type: string },
): void {
  if (snapshot.cleanup && event.type !== "run_discarded")
    throw new Error("Execution resources were cleaned up; discard this run");
}
