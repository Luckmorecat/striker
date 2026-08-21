import { randomUUID } from "node:crypto";

import {
  createAcpRuntime,
  createAgentRegistry,
  createRuntimeStore,
  type AcpPermissionDecision,
  type AcpPermissionRequest,
  type AcpRuntimeDoctorReport,
  type AcpRuntimeEnsureInput,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeTurn,
} from "acpx/runtime";

import type {
  AgentHarness,
  AgentRequest,
  AgentRunner,
  AgentTurn,
  ApprovalMode,
  HarnessPreflightRequest,
} from "../core/contracts.js";
import {
  assertPermissionCapability,
  assertPreflightResult,
  harnessPreflightPrompt,
} from "../preflight/harness-preflight.js";
import { permissionPolicyFor } from "../permissions/permission-policy.js";

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
  readonly approvalMode?: ApprovalMode;
  readonly cwd: string;
  readonly harness: AgentHarness;
  readonly preflightRuntime?: AcpxRuntimeBoundary;
  readonly runtime: AcpxRuntimeBoundary;
}

const harnessCapabilities: Readonly<
  Record<AgentHarness, { readonly agent: string }>
> = {
  claude: { agent: "claude" },
  codex: { agent: "codex" },
  opencode: { agent: "opencode" },
  pi: { agent: "pi" },
};

function promptText(request: AgentRequest): string {
  const sections = [
    request.workflowInstructions === undefined
      ? undefined
      : `# Packaged Striker workflow\n\n${request.workflowInstructions}`,
    `# Implementation task\n\n${request.instructions}`,
    request.skills.length === 0
      ? undefined
      : `# Configured installed skills\n\nApply these after the packaged workflow:\n${request.skills.map((skill) => `$${skill}`).join("\n")}`,
  ];
  return sections.filter((section) => section !== undefined).join("\n\n");
}

function collectText(events: AsyncIterable<AcpRuntimeEvent>): Promise<string> {
  return (async () => {
    let output = "";
    for await (const event of events) {
      if (event.type === "text_delta" && event.stream !== "thought") {
        output += event.text;
      }
    }
    return output;
  })();
}

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

  async runInNewSession(request: AgentRequest): Promise<AgentTurn> {
    const sessionKey = `striker-${randomUUID()}`;
    const sessionEnvironment = permissionPolicyFor(
      this.options.approvalMode ?? "attended",
    ).sessionEnvironment;
    const handle = await this.options.runtime.ensureSession({
      agent: harnessCapabilities[this.options.harness].agent,
      cwd: this.options.cwd,
      mode: "persistent",
      sessionKey,
      ...(sessionEnvironment === undefined
        ? {}
        : { sessionOptions: { env: sessionEnvironment } }),
    });
    const turn = this.options.runtime.startTurn({
      handle,
      mode: "prompt",
      requestId: randomUUID(),
      text: promptText(request),
    });
    const outputPromise = collectText(turn.events);
    const result = await turn.result;
    const output = await outputPromise;
    const session = {
      id: handle.agentSessionId ?? handle.backendSessionId ?? sessionKey,
    };
    if (result.status === "completed") {
      return { output, session, status: "returned" };
    }
    const error =
      result.status === "failed"
        ? result.error.message
        : (result.stopReason ?? "Agent turn was cancelled");
    return { error, session, status: "failed" };
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
        agent: harnessCapabilities[this.options.harness].agent,
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
      const outputPromise = collectText(turn.events);
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
  const runtime = createAcpRuntime({
    agentRegistry,
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
    runtime,
  });
}
