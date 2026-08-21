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
  AgentRequest,
  AgentRunner,
  AgentTurn,
} from "../core/contracts.js";

export interface AcpxRuntimeBoundary {
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
  readonly cwd: string;
  readonly runtime: AcpxRuntimeBoundary;
}

function promptText(request: AgentRequest): string {
  const sections = [
    request.workflowInstructions === undefined
      ? undefined
      : `# Packaged Striker workflow\n\n${request.workflowInstructions}`,
    `# Implementation task\n\n${request.instructions}`,
    request.skills.length === 0
      ? undefined
      : `# Configured installed skills\n\n${request.skills.join("\n")}`,
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

export class AcpxAgentRunner implements AgentRunner {
  constructor(private readonly options: RunnerOptions) {}

  async preflight(): Promise<void> {
    await this.options.runtime.probeAvailability();
    const report = await this.options.runtime.doctor();
    if (!report.ok)
      throw new Error(`Codex preflight failed: ${report.message}`);
  }

  async runInNewSession(request: AgentRequest): Promise<AgentTurn> {
    const sessionKey = `striker-${randomUUID()}`;
    const handle = await this.options.runtime.ensureSession({
      agent: "codex",
      cwd: this.options.cwd,
      mode: "persistent",
      sessionKey,
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
}

export function createAcpxAgentRunner(options: {
  readonly cwd: string;
  readonly permissionRelay: PermissionRelay;
  readonly stateDir: string;
}): AcpxAgentRunner {
  const runtime = createAcpRuntime({
    agentRegistry: createAgentRegistry(),
    cwd: options.cwd,
    nonInteractivePermissions: "fail",
    onPermissionRequest: (request) => options.permissionRelay(request),
    permissionMode: "approve-reads",
    sessionStore: createRuntimeStore({ stateDir: options.stateDir }),
  });
  return new AcpxAgentRunner({ cwd: options.cwd, runtime });
}
