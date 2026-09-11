import { randomUUID } from "node:crypto";

import {
  createAcpRuntime,
  createAgentRegistry,
  createRuntimeStore,
  type AcpAgentRegistry,
  type AcpPermissionDecision,
  type AcpPermissionRequest,
  type AcpRuntimeDoctorReport,
  type AcpRuntimeEnsureInput,
  type AcpRuntimeHandle,
  type AcpRuntimeTurn,
} from "acpx/runtime";

import type {
  AgentHarness,
  AgentRequest,
  AgentRunner,
  AgentSession,
  AgentTurn,
  ApprovalMode,
  HarnessPreflightRequest,
  InitialDeliveryRecovery,
  ReviewRequest,
  ReviewTurn,
} from "../core/contracts.js";
import {
  assertPermissionCapability,
  assertPreflightResult,
  harnessPreflightPrompt,
} from "../preflight/harness-preflight.js";
import { permissionPolicyFor } from "../permissions/permission-policy.js";
import { collectFinalMessage, collectWholeOutput } from "./acp-output.js";
import { runReviewSession } from "./review-session.js";
import { initialDeliveryPrompt, taskPromptText } from "./task-prompt.js";

export interface AcpxRuntimeBoundary {
  close(input: {
    readonly handle: AcpRuntimeHandle;
    readonly reason: string;
    readonly discardPersistentState?: boolean;
  }): Promise<void>;
  doctor(): Promise<AcpRuntimeDoctorReport>;
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
  probeAvailability(): Promise<void>;
  startTurn(input: {
    readonly handle: AcpRuntimeHandle;
    readonly mode: "prompt";
    readonly requestId: string;
    readonly text: string;
  }): AcpRuntimeTurn;
}

export type PermissionRelay = (
  request: AcpPermissionRequest,
) => Promise<AcpPermissionDecision | undefined>;

interface RunnerOptions {
  readonly agent?: string;
  readonly approvalMode?: ApprovalMode;
  readonly cwd: string;
  readonly harness: AgentHarness;
  readonly preflightRuntime?: AcpxRuntimeBoundary;
  readonly reviewRuntime?: AcpxRuntimeBoundary;
  readonly runtime: AcpxRuntimeBoundary;
}

export function createTaskAgentRegistry(
  registry: AcpAgentRegistry,
  agent: string,
  environment?: Readonly<Record<string, string>>,
): AcpAgentRegistry {
  return {
    list: () => registry.list(),
    resolve: (agentName) => {
      const command = registry.resolve(agentName);
      if (agentName !== agent || environment === undefined) {
        return command;
      }
      if (!Array.isArray(command)) {
        throw new Error(
          `Agent "${agent}" must resolve to structured argv to configure its environment`,
        );
      }
      const assignments = Object.entries(environment).map(
        ([name, value]) => `${name}=${value}`,
      );
      return ["/usr/bin/env", ...assignments, ...command];
    },
  };
}

const harnessCapabilities: Readonly<
  Record<AgentHarness, { readonly agent: string }>
> = {
  claude: { agent: "claude" },
  codex: { agent: "codex" },
  opencode: { agent: "opencode" },
  pi: { agent: "pi" },
};

function doctorFailure(report: AcpRuntimeDoctorReport): {
  readonly kind: "authentication failed" | "is unavailable";
  readonly message: string;
} {
  const message = [report.message, ...(report.details ?? [])].join("; ");
  return {
    kind: /auth|credential|log[ -]?in|token|api key/iu.test(message)
      ? "authentication failed"
      : "is unavailable",
    message,
  };
}

export class AcpxAgentRunner implements AgentRunner {
  constructor(private readonly options: RunnerOptions) {}

  async preflight(request: HarnessPreflightRequest): Promise<void> {
    this.assertHarnessSupportsMode();
    const runtime = this.options.preflightRuntime ?? this.options.runtime;
    await this.probeHarness(runtime);
    const report = await runtime.doctor();
    if (!report.ok) {
      const failure = doctorFailure(report);
      throw new Error(
        `Harness "${this.options.harness}" ${failure.kind}: ${failure.message}`,
      );
    }
    await this.probeSkills(runtime, request.skills);
  }

  async runInNewSession(
    request: AgentRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<AgentTurn> {
    const sessionKey = `striker-${randomUUID()}`;
    const handle = await this.options.runtime.ensureSession({
      agent:
        this.options.agent ?? harnessCapabilities[this.options.harness].agent,
      cwd: this.options.cwd,
      mode: "persistent",
      sessionKey,
    });
    return this.withTaskHandle(handle, async () => {
      const session = {
        id: sessionKey,
        ...(handle.backendSessionId === undefined
          ? {}
          : { resumeId: handle.backendSessionId }),
      };
      await sessionStarted?.(session);
      return this.runTurn(handle, session, taskPromptText(request));
    });
  }

  async resumeSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn> {
    return this.resumeTaskSession(session, instructions);
  }

  async resumeInitialSession(
    session: AgentSession,
    recovery: InitialDeliveryRecovery,
  ): Promise<AgentTurn> {
    return this.resumeTaskSession(session, initialDeliveryPrompt(recovery));
  }

  private async resumeTaskSession(
    session: AgentSession,
    instructions: string,
  ): Promise<AgentTurn> {
    const handle = await this.options.runtime.ensureSession({
      agent:
        this.options.agent ?? harnessCapabilities[this.options.harness].agent,
      cwd: this.options.cwd,
      mode: "persistent",
      sessionKey: session.id,
      ...(session.resumeId === undefined
        ? {}
        : { resumeSessionId: session.resumeId }),
    });
    return this.withTaskHandle(handle, () => {
      if (
        session.resumeId !== undefined &&
        handle.backendSessionId !== session.resumeId
      ) {
        throw new Error("Agent runner replaced the preserved backend session");
      }
      return this.runTurn(handle, session, instructions);
    });
  }

  async runReviewInNewSession(
    request: ReviewRequest,
    sessionStarted?: (session: AgentSession) => Promise<void>,
  ): Promise<ReviewTurn> {
    const runtime = this.options.reviewRuntime;
    if (runtime === undefined) {
      throw new Error(
        "Agent runner requires an explicit read-only review runtime",
      );
    }
    return runReviewSession({
      agent:
        this.options.agent ?? harnessCapabilities[this.options.harness].agent,
      cwd: this.options.cwd,
      request,
      runtime,
      ...(sessionStarted === undefined ? {} : { sessionStarted }),
    });
  }

  private async runTurn(
    handle: AcpRuntimeHandle,
    session: AgentSession,
    text: string,
  ): Promise<AgentTurn> {
    const turn = this.options.runtime.startTurn({
      handle,
      mode: "prompt",
      requestId: randomUUID(),
      text,
    });
    const outputPromise = collectFinalMessage(turn.events);
    const result = await turn.result;
    const output = await outputPromise;
    if (result.status === "completed") {
      return { output, session, status: "returned" };
    }
    const error =
      result.status === "failed"
        ? result.error.message
        : (result.stopReason ?? "Agent turn was cancelled");
    return { error, session, status: "failed" };
  }

  private async withTaskHandle<T>(
    handle: AcpRuntimeHandle,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } finally {
      await this.options.runtime.close({
        handle,
        reason: "Striker task turn complete",
      });
    }
  }

  private async probeHarness(runtime: AcpxRuntimeBoundary): Promise<void> {
    try {
      await runtime.probeAvailability();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Harness "${this.options.harness}" is unavailable: ${message}`,
        { cause: error },
      );
    }
  }

  private async probeSkills(
    runtime: AcpxRuntimeBoundary,
    skills: readonly string[],
  ): Promise<void> {
    const sessionKey = `striker-preflight-${randomUUID()}`;
    let handle: AcpRuntimeHandle;
    try {
      handle = await runtime.ensureSession({
        agent:
          this.options.agent ?? harnessCapabilities[this.options.harness].agent,
        cwd: this.options.cwd,
        mode: "persistent",
        sessionKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Harness "${this.options.harness}" authentication failed: ${message}`,
        { cause: error },
      );
    }
    try {
      const turn = runtime.startTurn({
        handle,
        mode: "prompt",
        requestId: randomUUID(),
        text: harnessPreflightPrompt(skills),
      });
      const outputPromise = collectWholeOutput(turn.events);
      const result = await turn.result;
      const output = await outputPromise;
      if (result.status !== "completed") {
        const message =
          result.status === "failed"
            ? result.error.message
            : (result.stopReason ?? "session cancelled");
        throw new Error(
          `Harness "${this.options.harness}" preflight session failed: ${message}`,
        );
      }
      assertPreflightResult(this.options.harness, skills, output);
    } finally {
      await runtime.close({
        discardPersistentState: true,
        handle,
        reason: "Striker preflight complete",
      });
    }
  }

  private assertHarnessSupportsMode(): void {
    assertPermissionCapability(
      this.options.harness,
      this.options.approvalMode ?? "attended",
    );
  }
}

export function createAcpxAgentRunner(options: {
  readonly approvalMode: ApprovalMode;
  readonly cwd: string;
  readonly harness: AgentHarness;
  readonly permissionRelay: PermissionRelay;
  readonly stateDir: string;
}): AcpxAgentRunner {
  const policy = permissionPolicyFor(options.approvalMode);
  const agent = harnessCapabilities[options.harness].agent;
  const agentRegistry = createAgentRegistry();
  const taskAgentRegistry = createTaskAgentRegistry(
    agentRegistry,
    agent,
    policy.agentEnvironment,
  );
  const runtime = createAcpRuntime({
    agentRegistry: taskAgentRegistry,
    cwd: options.cwd,
    nonInteractivePermissions: policy.nonInteractivePermissions,
    onPermissionRequest: (request) =>
      policy.relayRequests
        ? options.permissionRelay(request)
        : Promise.resolve({ outcome: "reject_once" }),
    permissionMode: policy.acpxPermissionMode,
    sessionStore: createRuntimeStore({ stateDir: options.stateDir }),
  });
  const preflightRuntime = createAcpRuntime({
    agentRegistry,
    cwd: options.cwd,
    nonInteractivePermissions: "deny",
    onPermissionRequest: () => Promise.resolve({ outcome: "reject_once" }),
    permissionMode: "approve-reads",
    probeAgent: agent,
    sessionStore: createRuntimeStore({ stateDir: options.stateDir }),
  });
  return new AcpxAgentRunner({
    approvalMode: options.approvalMode,
    cwd: options.cwd,
    harness: options.harness,
    preflightRuntime,
    reviewRuntime: preflightRuntime,
    runtime,
  });
}
