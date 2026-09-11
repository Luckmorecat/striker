import type {
  AgentHarness,
  AgentRunner,
  ApprovalMode,
  GitRepository,
  Verifier,
} from "./contracts.js";

export interface ExecutionServices {
  readonly runner: AgentRunner;
  readonly git: GitRepository;
  readonly verifier: Verifier;
}

export interface ExecutionEnvironmentRequest {
  readonly approvalMode: ApprovalMode;
  readonly harness: AgentHarness;
  readonly projectRoot: string;
  readonly stateRoot: string;
}

/** Opens execution services for a command, including recovery commands. */
export interface ExecutionEnvironment {
  open(request: ExecutionEnvironmentRequest): Promise<ExecutionServices>;
}

export interface ExecutionRunDescriptor {
  readonly backend: "docker";
  readonly environmentId: string;
  readonly imageId: string;
  readonly sourceHead: string;
  readonly sourceBranch: string;
}
