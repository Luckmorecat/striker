import type { ModelSelection } from "./subscription.js";

export interface PreparedEnvironmentImage {
  readonly imageId: string;
  readonly baselineId: string;
}

export interface EnvironmentPreparer {
  prepare(approveImage: boolean): Promise<PreparedEnvironmentImage>;
}

export interface FeatureEnvironmentResources {
  readonly cpus: number;
  readonly memoryMiB: number;
  readonly pids: number;
}

export interface FeatureEnvironmentAllocation {
  readonly runId: string;
  readonly stateRoot: string;
  readonly image: PreparedEnvironmentImage;
  readonly resources: FeatureEnvironmentResources;
  readonly gateway?: {
    readonly socketPath: string;
    readonly selection: ModelSelection;
  };
}

export interface RetainedFeatureEnvironment {
  readonly environmentId: string;
  readonly imageId: string;
  readonly checkout: string;
  readonly state: string;
  readonly output: string;
  readonly inputs: string;
}

/** Resource preparation only; does not grant execution or model access. */
export interface FeatureEnvironmentProvisioner {
  allocate(
    request: FeatureEnvironmentAllocation,
  ): Promise<RetainedFeatureEnvironment>;
}
