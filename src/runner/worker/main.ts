import { createInterface } from "node:readline";
import { GitCliRepository } from "../../infrastructure/git-cli.js";
import { ShellVerifier } from "../../infrastructure/shell-verifier.js";
import type { AgentSession, AgentRequest } from "../../core/contracts.js";
import type { RunObserver } from "../../core/run-observation.js";
import {
  parseWorkerRequest,
  maximumFrameBytes,
  type WorkerRequest,
} from "./protocol.js";
import { createWorkerRunner } from "./runner.js";

function emit(value: unknown): void {
  const frame = JSON.stringify(value);
  if (Buffer.byteLength(frame) > maximumFrameBytes)
    throw new Error("Worker result exceeds limit");
  process.stdout.write(`${frame}\n`);
}
/** Activity is display text: it never acknowledges a session or a result. */
function activityObserver(id: string): RunObserver {
  return {
    observe: (observation) => {
      if (observation.kind !== "activity") return;
      emit({
        id,
        type: "activity",
        activity: observation.activity,
        text: observation.text,
      });
    },
  };
}
async function execute(
  request: WorkerRequest,
  started: (session: AgentSession) => Promise<void>,
): Promise<unknown> {
  const git = new GitCliRepository();
  const cwd = process.cwd();
  const observer = activityObserver(request.id);
  switch (request.operation) {
    case "inspect":
      return git.inspect(cwd);
    case "isAncestor":
      return git.isAncestor(cwd, request.ancestor, request.descendant);
    case "commitsBetween":
      return git.commitsBetween(cwd, request.ancestor, request.descendant);
    case "changedPaths":
      return git.changedPaths(cwd, request.ancestor, request.descendant);
    case "readFileAtCommit":
      return git.readFileAtCommit(cwd, request.commit, request.path);
    case "verify":
      return new ShellVerifier().verify({ cwd, command: request.command });
    case "implement":
      return createWorkerRunner(observer).runInNewSession(
        request.request as AgentRequest,
        started,
      );
    case "continue":
      return createWorkerRunner(observer).resumeSession(
        request.session as AgentSession,
        request.instructions,
      );
    case "review":
      return createWorkerRunner(observer).runReviewInNewSession(
        { instructions: request.instructions },
        started,
      );
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[
  Symbol.asyncIterator
]();
const first = await lines.next();
const request = parseWorkerRequest(String(first.value));
try {
  const value = await execute(request, async (session) => {
    emit({ id: request.id, type: "started", session });
    const acknowledgment = await lines.next();
    if (acknowledgment.value !== request.id)
      throw new Error("Host did not acknowledge durable stage delivery");
  });
  emit({ id: request.id, type: "result", value });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  emit({
    id: request.id,
    type: "error",
    message:
      code === "ENOSPC"
        ? "Isolated storage is full; free space in the retained environment before recovery"
        : code === "EAGAIN"
          ? "Isolated process limit exhausted; stop orphaned work before recovery"
          : "Isolated worker operation failed; inspect retained resources and session state before recovery",
  });
  process.exitCode = 1;
} finally {
  await lines.return?.();
  process.stdin.destroy();
}
