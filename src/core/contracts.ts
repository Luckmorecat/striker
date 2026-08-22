import type { AttentionReason, RunAttention } from "./run-journal-contracts.js";
import type {
  AgentSession,
  GitState,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
  TaskIdentity,
  VerificationResult,
} from "./execution-contracts.js";

export type {
  AgentSession,
  GitState,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskExecution,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSourceReference,
  VerificationResult,
} from "./execution-contracts.js";

export type TaskCompletionResult =
  | {
      readonly status: "completed";
      readonly evidence: TaskCompletionEvidence;
    }
  | {
      readonly status: "needs_attention";
      readonly attention: RunAttention;
    };

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
  finalizeCompleted?(completed: readonly TaskIdentity[]): Promise<void>;
}

export interface TaskSourceConflict {
  readonly completed: TaskIdentity;
  readonly current: TaskIdentity | null;
}

export interface TaskSourceAdapter {
  readonly type: string;
  open(location: string): Promise<TaskSource>;
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
  runInNewSession(
    request: AgentRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<AgentTurn>;
  resumeSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn>;
}

export interface VerificationRequest {
  readonly command: string;
  readonly cwd: string;
}

export interface Verifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
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

export type {
  AttentionReason,
  DispatchRequest,
  RunAttention,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  RunStatus,
  RunTransition,
} from "./run-journal-contracts.js";

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
      readonly session: AgentSession | null;
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
