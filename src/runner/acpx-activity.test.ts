import {
  type AcpRuntimeEnsureInput,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeTurn,
} from "acpx/runtime";
import { describe, expect, it } from "vitest";

import type { RunObservation } from "../core/run-observation.js";
import { AcpxAgentRunner, type AcpxRuntimeBoundary } from "./acpx-runner.js";

class FakeRuntime implements AcpxRuntimeBoundary {
  backendSessionId = "codex-session";
  readonly closed: {
    readonly discardPersistentState?: boolean;
    readonly handle: AcpRuntimeHandle;
    readonly reason: string;
  }[] = [];
  readonly ensureInputs: AcpRuntimeEnsureInput[] = [];
  doctorMessage = "ready";
  healthy = true;
  output = "done";
  outputEvents?: readonly AcpRuntimeEvent[];
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

  close(input: {
    readonly discardPersistentState?: boolean;
    readonly handle: AcpRuntimeHandle;
    readonly reason: string;
  }): Promise<void> {
    this.closed.push(input);
    return Promise.resolve();
  }

  startTurn(input: { readonly text: string }): AcpRuntimeTurn {
    this.turnText = input.text;
    const outputEvents = this.outputEvents ?? [
      { stream: "output", text: this.output, type: "text_delta" } as const,
    ];
    const events = (async function* (): AsyncGenerator<AcpRuntimeEvent> {
      await Promise.resolve();
      yield* outputEvents;
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

const reviewEvents: readonly AcpRuntimeEvent[] = [
  {
    messageId: "commentary",
    text: "Checking repository standards.",
    type: "text_delta",
  },
  {
    messageId: "result",
    text: JSON.stringify({
      findings: [],
      kind: "standards",
      resultCommit: "after",
      startCommit: "before",
      verdict: "passed",
    }),
    type: "text_delta",
  },
];

describe("acpx activity observation", () => {
  it("reports visible notes and tool calls from a task turn", async () => {
    const runtime = new FakeRuntime();
    runtime.outputEvents = [
      {
        messageId: "commentary",
        text: "Reading recovery.ts\n",
        type: "text_delta",
      },
      { stream: "thought", text: "hidden reasoning\n", type: "text_delta" },
      { text: "edit", title: "Edit answer-command.ts", type: "tool_call" },
      {
        messageId: "result",
        text: '{"kind":"implementation"}',
        type: "text_delta",
      },
    ];
    const observed: RunObservation[] = [];
    const runner = new AcpxAgentRunner({
      cwd: "/repo",
      harness: "codex",
      observer: {
        observe: (observation) => observed.push(observation),
      },
      runtime,
    });

    const result = await runner.runInNewSession({
      instructions: "Build.",
      skills: [],
    });

    expect(result).toMatchObject({ output: '{"kind":"implementation"}' });
    expect(observed).toEqual([
      { activity: "note", kind: "activity", text: "Reading recovery.ts" },
      { activity: "tool", kind: "activity", text: "Edit answer-command.ts" },
    ]);
  });

  it("reports review activity without disturbing the review result", async () => {
    const runtime = new FakeRuntime();
    runtime.outputEvents = [
      { text: "read", title: "Read diff", type: "tool_call" },
      ...reviewEvents,
    ];
    const observed: RunObservation[] = [];
    const runner = new AcpxAgentRunner({
      cwd: "/repo",
      harness: "codex",
      observer: { observe: (observation) => observed.push(observation) },
      reviewRuntime: runtime,
      runtime,
    });

    const turn = await runner.runReviewInNewSession({
      instructions: "Review.",
    });

    expect(turn).toMatchObject({ status: "returned" });
    expect(observed).toEqual([
      { activity: "tool", kind: "activity", text: "Read diff" },
      {
        activity: "note",
        kind: "activity",
        text: "Checking repository standards.",
      },
    ]);
  });
});
