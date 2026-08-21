export interface TaskIdentity {
  readonly id: string;
  readonly revision: string;
}

export interface ImplementationTask {
  readonly identity: TaskIdentity;
  readonly title: string;
  readonly instructions: string;
  readonly execution?: TaskExecution;
}

export interface TaskExecution {
  readonly affectedPaths: readonly string[];
  readonly cwd: string;
  readonly verifyCommand: string;
  readonly workflowInstructions: string;
}

export interface TaskCompletionEvidence {
  readonly summary: string;
  readonly verification?: VerificationResult;
}

export interface TaskExecutionEvidence {
  readonly after: GitState;
  readonly before: GitState;
  readonly commits: readonly string[];
  readonly verification: VerificationResult;
}

export interface TaskSource {
  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null>;
  completionEvidence(
    task: ImplementationTask,
    execution?: TaskExecutionEvidence,
  ): Promise<TaskCompletionEvidence | null>;
  markCompleted?(
    task: ImplementationTask,
    evidence: TaskCompletionEvidence,
  ): Promise<void>;
}

export interface TaskSourceAdapter {
  readonly type: string;
  open(location: string): Promise<TaskSource>;
}

export interface TaskSourceReference {
  readonly type: string;
  readonly location: string;
}

export interface AgentSession {
  readonly id: string;
}

export interface AgentRequest {
  readonly instructions: string;
  readonly skills: readonly string[];
  readonly workflowInstructions?: string;
}

export type AgentTurn =
  | {
      readonly status: "returned";
      readonly session: AgentSession;
      readonly output: string;
    }
  | {
      readonly status: "failed";
      readonly session: AgentSession;
      readonly error: string;
    };

export interface AgentRunner {
  preflight?(): Promise<void>;
  runInNewSession(request: AgentRequest): Promise<AgentTurn>;
}

export interface VerificationRequest {
  readonly command: string;
  readonly cwd: string;
}

export interface VerificationResult {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface Verifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

export interface GitState {
  readonly head: string;
  readonly dirtyPaths: readonly string[];
  readonly root: string;
  readonly trackedPatch: string;
  readonly untrackedHashes: Readonly<Record<string, string>>;
}

export interface GitRepository {
  commitsBetween(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<readonly string[]>;
  inspect(root: string): Promise<GitState>;
  resolveRoot(location: string): Promise<string>;
  resolvePrivatePath(root: string, name: string): Promise<string>;
}

export interface PlanValidationResult {
  readonly taskCount: number;
}

export interface PlanValidator {
  validate(source: string): Promise<PlanValidationResult>;
}

export interface PublicSkillInstallRequest {
  readonly harness: string;
  readonly projectRoot: string;
}

export interface PublicSkillInstallResult {
  readonly changed: boolean;
}

export interface PublicSkillInstaller {
  readonly supportedHarnesses: readonly string[];
  install(
    request: PublicSkillInstallRequest,
  ): Promise<PublicSkillInstallResult>;
}

export interface RunCommandRequest {
  readonly allowDirty: boolean;
  readonly source: string;
}

export interface RunCommandResult {
  readonly message: string;
  readonly status: "completed" | "needs_attention" | "failed";
}

export interface RunCommandHandler {
  run(request: RunCommandRequest): Promise<RunCommandResult>;
}

export type RunStatus =
  "created" | "running" | "needs_attention" | "failed" | "completed";

export type RunTransition =
  "start" | "complete" | "request_attention" | "fail" | "resume" | "retry";

export interface RunSnapshot {
  readonly runId: string;
  readonly status: RunStatus;
  readonly task: ImplementationTask | null;
  readonly session: AgentSession | null;
}

export type RunJournalEvent =
  | { readonly type: "run_started"; readonly runId: string }
  | {
      readonly type: "task_completed";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
      readonly evidence?: TaskCompletionEvidence;
      readonly execution?: TaskExecutionEvidence;
    }
  | {
      readonly type: "run_needs_attention";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
    }
  | {
      readonly type: "run_failed";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
      readonly error: string;
    };

export interface RunJournal {
  append(event: RunJournalEvent): Promise<void>;
  replace(snapshot: RunSnapshot): Promise<void>;
  delete(runId: string): Promise<void>;
}

export interface DispatchRequest {
  readonly allowDirty?: boolean;
  readonly runId: string;
  readonly taskSource: TaskSourceReference;
  readonly completedTasks: readonly TaskIdentity[];
  readonly skills: readonly string[];
}

export type DispatchResult =
  | {
      readonly status: "source_exhausted";
      readonly runId: string;
    }
  | {
      readonly status: "completed";
      readonly runId: string;
      readonly task: ImplementationTask;
      readonly session: AgentSession;
      readonly evidence: TaskCompletionEvidence;
    }
  | {
      readonly status: "needs_attention";
      readonly runId: string;
      readonly task: ImplementationTask;
      readonly session: AgentSession;
      readonly reason:
        | "completion_evidence_missing"
        | "git_evidence_invalid"
        | "verification_failed";
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly task: ImplementationTask;
      readonly session: AgentSession;
      readonly error: string;
    };
