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
  readonly title: string;
  readonly instructions: string;
  readonly execution?: TaskExecution;
}

export interface AgentSession {
  readonly id: string;
  readonly resumeId?: string;
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
