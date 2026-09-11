import type {
  AttentionReason,
  RunAttention,
  RunStatus,
} from "./run-journal-contracts.js";
import type {
  AgentRequest,
  AgentSession,
  GitState,
  InitialDeliveryRecovery,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskExecutionEvidence,
  TaskIdentity,
  VerificationResult,
} from "./execution-contracts.js";
import type { ReviewRequest, ReviewTurn } from "./review-contracts.js";

export type {
  AgentRequest,
  AgentSession,
  GitState,
  InitialDeliveryRecovery,
  ImplementationTask,
  TaskCompletionEvidence,
  TaskExecution,
  TaskExecutionEvidence,
  TaskIdentity,
  TaskSourceReference,
  VerificationResult,
} from "./execution-contracts.js";
export type {
  CertifiedOutcomeFact,
  DeliveredTaskOutcome,
  TaskOutcome,
  TaskOutcomeTransition,
} from "./outcome-contracts.js";

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
}

export interface TaskSourceConflict {
  readonly completed: TaskIdentity;
  readonly current: TaskIdentity | null;
}

export interface ImplementationResult {
  readonly discoveries: readonly import("./discovery-contracts.js").DiscoveryProposal[];
  readonly kind: "implementation";
  readonly outcomeFacts: readonly import("./outcome-contracts.js").OutcomeFactProposal[];
  readonly summary: string;
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
  resumeInitialSession?(
    session: AgentSession,
    recovery: InitialDeliveryRecovery,
  ): Promise<AgentTurn>;
  resumeSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn>;
  resumeReviewSession?(session: AgentSession): Promise<ReviewTurn>;
  runReviewInNewSession?(
    request: ReviewRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<ReviewTurn>;
}

export interface VerificationRequest {
  readonly command: string;
  readonly cwd: string;
}

export interface Verifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

export interface GitRepository {
  changedPaths(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<readonly string[]>;
  commitsBetween(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<readonly string[]>;
  inspect(root: string): Promise<GitState>;
  isAncestor?(
    root: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;
  readFileAtCommit?(
    root: string,
    commit: string,
    path: string,
  ): Promise<string | null>;
  resolveRoot(location: string): Promise<string>;
  resolvePrivatePath(root: string, name: string): Promise<string>;
}

export interface PlanValidationResult {
  readonly taskCount: number;
}

export interface PlanValidator {
  validate(source: string): Promise<PlanValidationResult>;
}

export interface PlanQueryDefinition {
  readonly assumptions: readonly PlanQueryLedgerDefinition[];
  readonly defaults: readonly PlanQueryLedgerDefinition[];
  readonly planId: string;
  readonly tasks: readonly TaskIdentity[];
}

export interface PlanQueryLedgerDefinition {
  readonly id: string;
  readonly statement: string;
}

export interface PlanLogReader {
  read(planId: string | null): Promise<string>;
}

export interface PlanQueryHandler {
  log(source: string): Promise<string>;
  status(source: string): Promise<PlanStatus>;
}

export interface PlanStatus {
  readonly activeRun: {
    readonly attempt: number | null;
    readonly runId: string;
  } | null;
  readonly assumptions: readonly PlanLedgerStatus[];
  readonly attention: PlanAttention | null;
  readonly defaults: readonly PlanLedgerStatus[];
  readonly planId: string;
  readonly reviews: readonly PlanReviewStatus[];
  readonly status: RunStatus | "not_started";
  readonly tasks: readonly PlanTaskStatus[];
}

export interface PlanLedgerStatus extends PlanQueryLedgerDefinition {
  readonly applied?: boolean;
  readonly decision?: "accepted" | "rejected";
  readonly deviation?: string;
  readonly locator?: import("./discovery-contracts.js").ResolvedDiscoveryProposal["locator"];
  readonly proposal?: string;
  readonly pauseReason?: "assumption_disproved" | "assumption_needs_decision";
  readonly reason?: string;
  readonly state:
    "confirmed" | "deviated" | "disproved" | "needs_decision" | "recorded";
}

export interface PlanTaskStatus extends TaskIdentity {
  readonly state: "active" | "completed" | "pending";
}

export interface PlanAttention {
  readonly detail: string;
  readonly reason: AttentionReason | "completed_task_changed";
}

export interface PlanReviewStatus {
  readonly plan: "passed";
  readonly standards: "passed";
  readonly task: TaskIdentity;
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
  readonly execution?: "local" | "docker";
  readonly allowDirty: boolean;
  readonly approvalMode: ApprovalMode;
  readonly source: string;
}

export interface RunCommandResult {
  readonly reason?: AttentionReason | "completed_task_changed";
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
  DiscoveryReviewRecord,
  DispatchRequest,
  PlanComplianceReviewState,
  RunAttention,
  RunJournal,
  RunJournalEvent,
  RunRecoveryState,
  RunSnapshot,
  RunStatus,
  RunTransition,
  StandardsReviewState,
} from "./run-journal-contracts.js";
export type {
  DiscoveryDecision,
  OutcomeFactDecision,
  PlanComplianceReviewResult,
  ReviewFinding,
  ReviewRequest,
  ReviewResult,
  ReviewTurn,
  StandardsReviewResult,
} from "./review-contracts.js";

export type DispatchResult = {
  readonly resultExport?: import("./result-export.js").ResultExportState;
} & (
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
    }
);
