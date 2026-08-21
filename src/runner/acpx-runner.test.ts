import type {
  AcpRuntimeEnsureInput,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurn,
} from "acpx/runtime";
import { describe, expect, it } from "vitest";

import { AcpxAgentRunner, type AcpxRuntimeBoundary } from "./acpx-runner.js";

class FakeRuntime implements AcpxRuntimeBoundary {
  ensureInput: AcpRuntimeEnsureInput | null = null;
  healthy = true;
  turnText = "";

  doctor() {
    return Promise.resolve({
      message: this.healthy ? "ready" : "login required",
      ok: this.healthy,
    });
  }

  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    this.ensureInput = input;
    return Promise.resolve({
      agentSessionId: "codex-session",
      backend: "acpx",
      runtimeSessionName: input.sessionKey,
      sessionKey: input.sessionKey,
    });
  }

  probeAvailability(): Promise<void> {
    return Promise.resolve();
  }

  startTurn(input: { readonly text: string }): AcpRuntimeTurn {
    this.turnText = input.text;
    const events = (async function* (): AsyncGenerator<AcpRuntimeEvent> {
      await Promise.resolve();
      yield { stream: "output", text: "done", type: "text_delta" };
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

describe("acpx Codex runner", () => {
  it("injects private workflow instructions into a fresh persistent session", async () => {
    const runtime = new FakeRuntime();
    const runner = new AcpxAgentRunner({ cwd: "/repo", runtime });

    await expect(
      runner.runInNewSession({
        instructions: "Build task 03.",
        skills: ["security"],
        workflowInstructions: "private implementor",
      }),
    ).resolves.toEqual({
      output: "done",
      session: { id: "codex-session" },
      status: "returned",
    });
    expect(runtime.ensureInput).toMatchObject({
      agent: "codex",
      mode: "persistent",
    });
    expect("skills" in (runtime.ensureInput ?? {})).toBe(false);
    expect(runtime.turnText).toContain(
      "# Packaged Striker workflow\n\nprivate implementor",
    );
    expect(runtime.turnText).toContain(
      "# Configured installed skills\n\nsecurity",
    );
  });

  it("fails preflight when Codex authentication is unavailable", async () => {
    const runtime = new FakeRuntime();
    runtime.healthy = false;

    await expect(
      new AcpxAgentRunner({ cwd: "/repo", runtime }).preflight(),
    ).rejects.toThrow("Codex preflight failed: login required");
  });
});
