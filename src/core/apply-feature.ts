import type { RunSnapshot } from "./contracts.js";
import { resultBranchName } from "./result-export.js";

export interface ApplicationIntent {
  readonly runId: string;
  readonly sourceRoot: string;
  readonly sourceBranch: string;
  readonly sourceHead: string;
  readonly resultBranch: string;
  readonly head: string;
}
export interface ApplicationState {
  readonly head: string;
  readonly status: "started" | "completed";
}
export type ApplicationEvent =
  | {
      readonly type: "application_started";
      readonly runId: string;
      readonly head: string;
    }
  | {
      readonly type: "application_completed";
      readonly runId: string;
      readonly head: string;
    };
export interface FeatureApplications {
  loadRun(runId: string): Promise<RunSnapshot | null>;
  append(event: ApplicationEvent): Promise<void>;
}
export interface ResultApplication {
  apply(
    intent: ApplicationIntent,
    state: ApplicationState | undefined,
    recordIntent: () => Promise<void>,
  ): Promise<void>;
}
export interface ApplyFeatureHandler {
  apply(runId: string): Promise<ApplicationIntent>;
}

export function applicationIntent(snapshot: RunSnapshot): ApplicationIntent {
  if (snapshot.status !== "completed" || snapshot.task !== null)
    throw new Error("Apply requires a successfully completed whole feature");
  const execution = snapshot.request.execution;
  const result = snapshot.resultExport;
  if (!execution || !result?.head || result.pending || result.error)
    throw new Error("Apply requires a fully exported isolated feature");
  if (result.branch !== resultBranchName(snapshot.runId))
    throw new Error("Result branch does not belong to the completed run");
  return {
    runId: snapshot.runId,
    sourceRoot: execution.sourceRoot,
    sourceBranch: execution.sourceBranch,
    sourceHead: execution.sourceHead,
    resultBranch: result.branch,
    head: result.head,
  };
}
export function replayApplication(
  snapshot: RunSnapshot,
  event: ApplicationEvent,
): RunSnapshot {
  const intent = applicationIntent(snapshot);
  if (event.runId !== intent.runId || event.head !== intent.head)
    throw new Error(
      "Application does not match the certified completed feature",
    );
  if (event.type === "application_completed" && !snapshot.application)
    throw new Error("Application completion is missing its durable intent");
  if (event.type === "application_started" && snapshot.application)
    throw new Error("Application already has a durable intent");
  return {
    ...snapshot,
    application: {
      head: event.head,
      status: event.type === "application_started" ? "started" : "completed",
    },
  };
}
export class ApplyFeature implements ApplyFeatureHandler {
  constructor(
    private readonly journal: FeatureApplications,
    private readonly target: ResultApplication,
  ) {}
  async apply(runId: string): Promise<ApplicationIntent> {
    const snapshot = await this.journal.loadRun(runId);
    if (!snapshot)
      throw new Error(`No recorded Striker run ${runId} in this repository`);
    const intent = applicationIntent(snapshot);
    await this.target.apply(intent, snapshot.application, () =>
      this.journal.append({
        type: "application_started",
        runId,
        head: intent.head,
      }),
    );
    if (snapshot.application?.status !== "completed")
      await this.journal.append({
        type: "application_completed",
        runId,
        head: intent.head,
      });
    return intent;
  }
}
