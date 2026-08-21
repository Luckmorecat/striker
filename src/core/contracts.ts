export interface TaskIdentity {
  readonly id: string;
  readonly revision: string;
}

export interface ImplementationTask {
  readonly identity: TaskIdentity;
  readonly title: string;
  readonly instructions: string;
}

export interface TaskCompletionEvidence {
  readonly summary: string;
}

export interface TaskSource {
  nextTask(
    completed: readonly TaskIdentity[],
  ): Promise<ImplementationTask | null>;
  completionEvidence(
    task: ImplementationTask,
  ): Promise<TaskCompletionEvidence | null>;
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
}

export interface GitRepository {
  inspect(root: string): Promise<GitState>;
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
      readonly reason: "completion_evidence_missing";
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly task: ImplementationTask;
      readonly session: AgentSession;
      readonly error: string;
    };
