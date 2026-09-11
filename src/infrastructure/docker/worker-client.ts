import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentSession } from "../../core/contracts.js";
import {
  maximumFrameBytes,
  parseWorkerRequest,
  parseWorkerResponse,
  type WorkerRequest,
} from "../../runner/worker/protocol.js";

type RequestBody = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, "id">
    : never
  : never;

/** This transport only accepts responses to host-selected operations. */
export async function callWorker(options: {
  readonly environmentId: string;
  readonly command: readonly string[];
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
  let buffer = "";
  let result: unknown;
  const progress = { completed: false };
  let started = false;
  const accept = async (frame: ReturnType<typeof parseWorkerResponse>) => {
    if (progress.completed)
      throw new Error("Worker sent output after completion");
    if (frame.type === "error") throw new Error(frame.message);
    if (frame.type === "started") {
      if (started || !options.started)
        throw new Error("Unexpected worker session announcement");
      await options.started(frame.session as AgentSession);
      started = true;
      child.stdin.write(`${id}\n`);
    } else {
      result = frame.value;
      progress.completed = true;
    }
  };
  try {
    for await (const chunk of child.stdout) {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer) > maximumFrameBytes)
        throw new Error("Worker frame exceeds limit");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const frame = parseWorkerResponse(
          buffer.slice(0, newline),
          id,
          request.operation,
        );
        buffer = buffer.slice(newline + 1);
        await accept(frame);
      }
    }
    await exit;
    if (!progress.completed || buffer)
      throw new Error("Incomplete worker result");
    return result;
  } finally {
    child.stdin.end();
    child.kill();
  }
}
