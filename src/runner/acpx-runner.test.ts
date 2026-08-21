import type {
  AcpRuntimeEnsureInput,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurn,
} from "acpx/runtime";
import { describe, expect, it } from "vitest";

import { agentHarnesses } from "../core/contracts.js";
import { AcpxAgentRunner, type AcpxRuntimeBoundary } from "./acpx-runner.js";

class FakeRuntime implements AcpxRuntimeBoundary {
  backendSessionId = "codex-session";
  readonly closed: AcpRuntimeHandle[] = [];
  readonly ensureInputs: AcpRuntimeEnsureInput[] = [];
  doctorMessage = "ready";
  healthy = true;
  output = "done";
  turnText = "";

  doctor() {
    return Promise.resolve({
      message: this.healthy ? "ready" : this.doctorMessage,
      ok: this.healthy,
    });
  }

  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    this.ensureInputs.push(input);
    return Promise.resolve({
      agentSessionId: `${input.agent}-session`,
      backend: "acpx",
      backendSessionId: this.backendSessionId,
      runtimeSessionName: input.sessionKey,
      sessionKey: input.sessionKey,
    });
  }

  probeAvailability(): Promise<void> {
    return Promise.resolve();
  }

  close(input: { readonly handle: AcpRuntimeHandle }): Promise<void> {
    this.closed.push(input.handle);
    return Promise.resolve();
  }

  startTurn(input: { readonly text: string }): AcpRuntimeTurn {
    this.turnText = input.text;
    const output = this.output;
    const events = (async function* (): AsyncGenerator<AcpRuntimeEvent> {
      await Promise.resolve();
      yield { stream: "output", text: output, type: "text_delta" };
    })();
    return {
      cancel: () => Promise.resolve(),
      closeStream: () => Promise.resolve(),
      events,
      promptStarted: Promise.resolve(),
      requestId: "request-1",
      result: Promise.resolve({ status: "completed" }),
    };
  }
}

describe("acpx task sessions", () => {
  it("injects private workflow instructions into a fresh persistent session", async () => {
    const runtime = new FakeRuntime();
    const runner = new AcpxAgentRunner({
      cwd: "/repo",
      harness: "codex",
      runtime,
    });

    const result = await runner.runInNewSession({
      instructions: "Build task 03.",
      skills: ["security"],
      workflowInstructions: "private implementor",
    });

    expect(result).toMatchObject({
      output: "done",
      session: { resumeId: "codex-session" },
      status: "returned",
    });
    expect(runtime.ensureInputs.at(-1)).toMatchObject({
      agent: "codex",
      mode: "persistent",
    });
    expect("skills" in (runtime.ensureInputs.at(-1) ?? {})).toBe(false);
    expect(runtime.turnText).toContain(
      "# Packaged Striker workflow\n\nprivate implementor",
    );
    expect(runtime.turnText).toContain(
      "# Configured installed skills\n\nApply these after the packaged workflow:\n$security",
    );
  });

  it("continues the exact persistent session", async () => {
    const runtime = new FakeRuntime();
    const runner = new AcpxAgentRunner({
      cwd: "/repo",
      harness: "codex",
      runtime,
    });
    const first = await runner.runInNewSession({
      instructions: "Build task 03.",
      skills: [],
    });

    const continued = await runner.resumeSession(
      first.session,
      "Use the existing schema.",
    );

    expect(continued.session).toEqual(first.session);
    expect(runtime.ensureInputs.at(-1)).toMatchObject({
      resumeSessionId: "codex-session",
      sessionKey: first.session.id,
    });
    expect(runtime.turnText).toBe("Use the existing schema.");
  });
});

describe("acpx recovered task sessions", () => {
  it("rejects a replacement backend session before starting its turn", async () => {
    const runtime = new FakeRuntime();
    runtime.backendSessionId = "replacement-session";
    const runner = new AcpxAgentRunner({
      cwd: "/repo",
      harness: "codex",
      runtime,
    });

    await expect(
      runner.resumeSession(
        { id: "runtime-key", resumeId: "preserved-session" },
        "Continue.",
      ),
    ).rejects.toThrow("replaced the preserved backend session");
    expect(runtime.turnText).toBe("");
  });
});

describe("acpx task preflight", () => {
  it("fails preflight when Codex authentication is unavailable", async () => {
    const runtime = new FakeRuntime();
    runtime.doctorMessage = "login required";
    runtime.healthy = false;

    await expect(
      new AcpxAgentRunner({
        cwd: "/repo",
        harness: "codex",
        runtime,
      }).preflight({
        skills: [],
      }),
    ).rejects.toThrow('Harness "codex" authentication failed: login required');
  });
});

describe("acpx harness preflight", () => {
  it.each(agentHarnesses)(
    "preflights %s in a disposable session",
    async (harness) => {
      const runtime = new FakeRuntime();
      runtime.output = 'STRIKER_PREFLIGHT_RESULT {"available":["security"]}';
      const runner = new AcpxAgentRunner({ cwd: "/repo", harness, runtime });

      await expect(
        runner.preflight({ skills: ["security"] }),
      ).resolves.toBeUndefined();

      expect(runtime.ensureInputs).toHaveLength(1);
      expect(runtime.ensureInputs[0]).toMatchObject({ agent: harness });
      expect(runtime.turnText).toContain('"security"');
      expect(runtime.turnText).not.toContain("striker-implementor");
      expect(runtime.closed).toHaveLength(1);
    },
  );

  it("names an unavailable harness", async () => {
    const runtime = new FakeRuntime();
    runtime.doctorMessage = "agent command not found";
    runtime.healthy = false;

    await expect(
      new AcpxAgentRunner({ cwd: "/repo", harness: "pi", runtime }).preflight({
        skills: [],
      }),
    ).rejects.toThrow('Harness "pi" is unavailable: agent command not found');
    expect(runtime.ensureInputs).toEqual([]);
  });

  it("names a missing configured skill", async () => {
    const runtime = new FakeRuntime();
    runtime.output = 'STRIKER_PREFLIGHT_RESULT {"available":[]}';

    await expect(
      new AcpxAgentRunner({
        cwd: "/repo",
        harness: "claude",
        runtime,
      }).preflight({
        skills: ["security"],
      }),
    ).rejects.toThrow(
      'Configured skill "security" is unavailable in harness "claude"',
    );
  });

  it("rejects auto-review when the selected harness has no reviewer capability", async () => {
    const runtime = new FakeRuntime();
    const runner = new AcpxAgentRunner({
      approvalMode: "auto-review",
      cwd: "/repo",
      harness: "claude",
      runtime,
    });

    await expect(runner.preflight({ skills: [] })).rejects.toThrow(
      'Harness "claude" does not support permission mode "auto-review"',
    );
    expect(runtime.ensureInputs).toEqual([]);
  });

  it("applies the proved Codex auto-review config to task sessions", async () => {
    const runtime = new FakeRuntime();
    runtime.output = 'STRIKER_PREFLIGHT_RESULT {"available":[]}';
    const runner = new AcpxAgentRunner({
      approvalMode: "auto-review",
      cwd: "/repo",
      harness: "codex",
      runtime,
    });

    await runner.preflight({ skills: [] });
    await runner.runInNewSession({ instructions: "Build.", skills: [] });

    expect(runtime.ensureInputs.at(-1)?.sessionOptions).toEqual({
      env: {
        CODEX_CONFIG:
          '{"approval_policy":"on-request","approvals_reviewer":"auto_review","sandbox_mode":"workspace-write"}',
      },
    });
  });
});
