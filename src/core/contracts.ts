export interface TaskIdentity {
  readonly id: string;
  readonly revision: string;
}

export interface ImplementationTask {
  readonly identity: TaskIdentity;
  readonly title: string;
  readonly instructions: string;
  readonly execution?: TaskExecution;
  readonly completionToken?: string;
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

export type TaskCompletionResult =
  | {
      readonly status: "completed";
      readonly evidence: TaskCompletionEvidence;
    }
  | {
      readonly status: "needs_attention";
      readonly attention: RunAttention;
    };

export interface TaskExecutionEvidence {
  readonly after: GitState;
  readonly before: GitState;
  readonly commits: readonly string[];
  readonly verification: VerificationResult;
}

export interface TaskSource {
  reconcileCompleted(
    completed: readonly TaskIdentity[],
  ): Promise<TaskSourceConflict | null>;
  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null>;
  completionEvidence(
    task: ImplementationTask,
    execution?: TaskExecutionEvidence,
    agentOutput?: string,
  ): Promise<TaskCompletionResult>;
  markCompleted?(
    task: ImplementationTask,
    evidence: TaskCompletionEvidence,
  ): Promise<void>;
}

export interface TaskSourceConflict {
  readonly completed: TaskIdentity;
  readonly current: TaskIdentity | null;
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
  readonly resumeId?: string;
}

export const agentHarnesses = ["codex", "claude", "opencode", "pi"] as const;
export type AgentHarness = (typeof agentHarnesses)[number];

export const approvalModes = ["attended", "auto-review", "unattended"] as const;
export type ApprovalMode = (typeof approvalModes)[number];

export interface PermissionConfig {
  read(): Promise<ApprovalMode>;
  write(mode: ApprovalMode): Promise<void>;
}

export interface HarnessPreflightRequest {
  readonly skills: readonly string[];
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
  preflight(request: HarnessPreflightRequest): Promise<void>;
  runInNewSession(request: AgentRequest): Promise<AgentTurn>;
  resumeSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn>;
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
  readonly approvalMode: ApprovalMode;
  readonly source: string;
}

export interface RunCommandResult {
  readonly message: string;
  readonly status: "completed" | "needs_attention" | "failed";
}

export interface RunCommandHandler {
  run(request: RunCommandRequest): Promise<RunCommandResult>;
}

export interface RecoveryCommandHandler {
  answer(answer: string): Promise<RunCommandResult>;
  resume(): Promise<RunCommandResult>;
}

export type RunStatus =
  "created" | "running" | "needs_attention" | "failed" | "completed";

export type AttentionReason =
  | "completion_evidence_missing"
  | "commit_evidence_missing"
  | "dirty_final_state"
  | "human_log_missing"
  | "review_evidence_missing"
  | "session_resume_failed"
  | "verification_failed";

export interface RunAttention {
  readonly detail: string;
  readonly reason: AttentionReason;
}

export type RunTransition =
  | "start"
  | "complete_task"
  | "complete"
  | "request_attention"
  | "fail"
  | "answer"
  | "resume"
  | "retry";

export interface RunSnapshot {
  readonly runId: string;
  readonly status: RunStatus;
  readonly task: ImplementationTask | null;
  readonly session: AgentSession | null;
  readonly attention?: RunAttention | null;
  readonly before?: GitState | null;
  readonly request?: DispatchRequest;
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
      readonly attention: RunAttention;
    }
  | {
      readonly type: "run_answered";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
      readonly answer: string;
    }
  | {
      readonly type: "run_resumed";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
      readonly attention: RunAttention;
    }
  | {
      readonly type: "run_failed";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly session: AgentSession;
      readonly error: string;
    }
  | {
      readonly type: "run_source_changed";
      readonly runId: string;
      readonly task: TaskIdentity;
      readonly current: TaskIdentity | null;
    };

export interface RunJournal {
  append(event: RunJournalEvent): Promise<void>;
  replace(snapshot: RunSnapshot): Promise<void>;
  delete(runId: string): Promise<void>;
  load(runId: string): Promise<RunRecoveryState | null>;
  loadActive(): Promise<RunRecoveryState | null>;
}

export interface RunRecoveryState {
  readonly completedTasks: readonly TaskIdentity[];
  readonly snapshot: RunSnapshot | null;
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
      readonly reason: AttentionReason;
    }
  | {
      readonly status: "needs_attention";
      readonly runId: string;
      readonly task: null;
      readonly session: null;
      readonly reason: "completed_task_changed";
      readonly completedTask: TaskIdentity;
      readonly currentTask: TaskIdentity | null;
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly task: ImplementationTask;
      readonly session: AgentSession;
      readonly error: string;
    };
