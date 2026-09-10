import path from "node:path";

import type {
  ExecutionEnvironment,
  ExecutionEnvironmentRequest,
  ExecutionServices,
} from "../core/execution-environment.js";
import {
  createAcpxAgentRunner,
  type PermissionRelay,
} from "../runner/acpx-runner.js";
import { GitCliRepository } from "./git-cli.js";
import { ShellVerifier } from "./shell-verifier.js";

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  /** Host metadata access stays separate from the execution service ports. */
  readonly hostGit = new GitCliRepository();

  constructor(private readonly permissionRelay: PermissionRelay) {}

  open(request: ExecutionEnvironmentRequest): Promise<ExecutionServices> {
    return Promise.resolve({
      git: new GitCliRepository(),
      runner: createAcpxAgentRunner({
        approvalMode: request.approvalMode,
        cwd: request.projectRoot,
        harness: request.harness,
        permissionRelay: this.permissionRelay,
        stateDir: path.join(request.stateRoot, "acpx"),
      }),
      verifier: new ShellVerifier(),
    });
  }
}
