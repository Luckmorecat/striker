import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentSession } from "../../core/contracts.js";
import type { RunActivity } from "../../core/run-observation.js";
import {
  maximumFrameBytes,
  parseWorkerRequest,
  parseWorkerResponse,
  type WorkerOperation,
  type WorkerRequest,
} from "../../runner/worker/protocol.js";

type RequestBody = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, "id">
    : never
  : never;

export interface WorkerResponseOptions {
  /** Confirms durable delivery before the worker may proceed. */
  readonly acknowledge: () => void;
  readonly activity?: (activity: RunActivity) => void;
  readonly id: string;
  readonly operation: WorkerOperation;
  readonly started?: (session: AgentSession) => Promise<void>;
}

export interface WorkerResponses {
  accept(frame: string): Promise<void>;
  readonly completed: boolean;
  readonly value: unknown;
}

/** Only correlated, host-selected frames are accepted, in worker order. */
export function workerResponses(
  options: WorkerResponseOptions,
): WorkerResponses {
  let completed = false;
  let started = false;
  let value: unknown;
  return {
    accept: async (frame) => {
      const parsed = parseWorkerResponse(frame, options.id, options.operation);
      // Display text can never fail, complete or certify an operation.
      if (parsed.type === "activity") {
        if (completed) return;
        try {
          options.activity?.({ activity: parsed.activity, text: parsed.text });
        } catch {
          // One broken display must not abort the worker operation.
        }
        return;
      }
      if (completed) throw new Error("Worker sent output after completion");
      if (parsed.type === "error") throw new Error(parsed.message);
      if (parsed.type === "started") {
        if (started || !options.started)
          throw new Error("Unexpected worker session announcement");
        await options.started(parsed.session as AgentSession);
        started = true;
        options.acknowledge();
        return;
      }
      value = parsed.value;
      completed = true;
    },
    get completed() {
      return completed;
    },
    get value() {
      return value;
    },
  };
}

/** stdout chunks split and batch frames; returns whatever stayed unterminated. */
export async function consumeFrames(
  chunks: AsyncIterable<unknown>,
  accept: (frame: string) => Promise<void>,
): Promise<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer) > maximumFrameBytes)
      throw new Error("Worker frame exceeds limit");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const frame = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await accept(frame);
    }
  }
  return buffer;
}

/** This transport only accepts responses to host-selected operations. */
export async function callWorker(options: {
  readonly environmentId: string;
  readonly command: readonly string[];
  readonly activity?: (activity: RunActivity) => void;
  readonly request: RequestBody;
  readonly started?: (session: AgentSession) => Promise<void>;
}): Promise<unknown> {
  if (!/^[a-f0-9]{64}$/.test(options.environmentId))
    throw new Error("Invalid worker container identity");
  const id = randomUUID();
  const request = parseWorkerRequest(
    JSON.stringify({ ...options.request, id }),
  );
  const child = spawn(
    "docker",
    ["exec", "-i", options.environmentId, ...options.command],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            code === 137
              ? "Isolated worker was killed (exit 137); inspect container memory/resource limits and retained files before resuming"
              : `Isolated worker exited (${String(code)}); inspect retained container resources and resume or explicitly retry`,
          ),
        );
    });
  });
  // Observe exit rejection immediately while consuming the framed response.
  void exit.catch(() => undefined);
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdin.on("error", () => undefined);
  child.stdin.write(`${JSON.stringify(request)}\n`);
  const responses = workerResponses({
    acknowledge: () => child.stdin.write(`${id}\n`),
    ...(options.activity === undefined ? {} : { activity: options.activity }),
    id,
    operation: request.operation,
    ...(options.started === undefined ? {} : { started: options.started }),
  });
  try {
    const trailing = await consumeFrames(child.stdout, (frame) =>
      responses.accept(frame),
    );
    await exit;
    if (!responses.completed || trailing)
      throw new Error("Incomplete worker result");
    return responses.value;
  } finally {
    child.stdin.end();
    child.kill();
  }
}
