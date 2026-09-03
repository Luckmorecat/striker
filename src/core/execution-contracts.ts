export interface TaskIdentity {
  readonly id: string;
  readonly revision: string;
}

export interface TaskExecution {
  readonly affectedPaths: readonly string[];
  readonly cwd: string;
  readonly verifyCommand: string;
  readonly workflowInstructions: string;
}

export interface ImplementationTask {
  readonly identity: TaskIdentity;
  readonly outcomePlanId?: string;
  readonly outcomePlanRoutes?: readonly import("./outcome-contracts.js").OutcomeRoute[];
  readonly outcomeRoutes?: readonly TaskIdentity[];
  readonly outcomeTaskOrder?: readonly TaskIdentity[];
  readonly outcomeTargets?: readonly import("./outcome-contracts.js").OutcomeTarget[];
  readonly title: string;
  readonly instructions: string;
  readonly execution?: TaskExecution;
}

export interface AgentSession {
  readonly id: string;
  readonly resumeId?: string;
}

export interface AgentRequest {
  readonly instructions: string;
  readonly priorTaskEvidence?: readonly import("./outcome-contracts.js").DeliveredTaskOutcome[];
  readonly skills: readonly string[];
  readonly workflowInstructions?: string;
}

export interface InitialDeliveryRecovery {
  readonly kind: "uncertain_initial_delivery";
  readonly request: AgentRequest;
}

export interface VerificationResult {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface GitState {
  readonly head: string;
  readonly dirtyPaths: readonly string[];
  readonly root: string;
  readonly trackedPatch: string;
  readonly untrackedHashes: Readonly<Record<string, string>>;
}

export interface TaskCompletionEvidence {
  readonly discoveries?: readonly import("./discovery-contracts.js").DiscoveryProposal[];
  readonly outcomeFacts?: readonly import("./outcome-contracts.js").OutcomeFactProposal[];
  readonly summary: string;
  readonly verification?: VerificationResult;
}

export interface TaskExecutionEvidence {
  readonly after: GitState;
  readonly before: GitState;
  readonly changedPaths: readonly string[];
  readonly commits: readonly string[];
  readonly verification: VerificationResult;
}

export interface TaskSourceReference {
  readonly type: string;
  readonly location: string;
}
