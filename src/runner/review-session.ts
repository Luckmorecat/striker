import { randomUUID } from "node:crypto";

import type {
  AcpRuntimeEnsureInput,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurn,
} from "acpx/runtime";

import type {
  AgentSession,
  ReviewRequest,
  ReviewTurn,
} from "../core/contracts.js";
import { parseReviewResult } from "./review-result.js";

interface ReviewRuntime {
  close(input: {
    readonly discardPersistentState?: boolean;
    readonly handle: AcpRuntimeHandle;
    readonly reason: string;
  }): Promise<void>;
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
  startTurn(input: {
    readonly handle: AcpRuntimeHandle;
    readonly mode: "prompt";
    readonly requestId: string;
    readonly text: string;
  }): AcpRuntimeTurn;
}

async function collectText(events: AsyncIterable<AcpRuntimeEvent>) {
  let output = "";
  for await (const event of events) {
    if (event.type === "text_delta" && event.stream !== "thought") {
      output += event.text;
    }
  }
  return output;
}

export async function runReviewSession(input: {
  readonly agent: string;
  readonly cwd: string;
  readonly request: ReviewRequest;
  readonly runtime: ReviewRuntime;
  readonly sessionStarted?: (session: AgentSession) => Promise<void>;
}): Promise<ReviewTurn> {
  const sessionKey = `striker-review-${randomUUID()}`;
  const handle = await input.runtime.ensureSession({
    agent: input.agent,
    cwd: input.cwd,
    mode: "persistent",
    sessionKey,
  });
  const session = {
    id: sessionKey,
    ...(handle.backendSessionId === undefined
      ? {}
      : { resumeId: handle.backendSessionId }),
  };
  try {
    await input.sessionStarted?.(session);
    const turn = input.runtime.startTurn({
      handle,
      mode: "prompt",
      requestId: randomUUID(),
      text: input.request.instructions,
    });
    const outputPromise = collectText(turn.events);
    const result = await turn.result;
    const output = await outputPromise;
    if (result.status === "completed") {
      return {
        result: parseReviewResult(output),
        session,
        status: "returned",
      };
    }
    return {
      error:
        result.status === "failed"
          ? result.error.message
          : (result.stopReason ?? "Reviewer turn was cancelled"),
      session,
      status: "failed",
    };
  } finally {
    await input.runtime.close({
      discardPersistentState: true,
      handle,
      reason: "Striker review turn complete",
    });
  }
}
