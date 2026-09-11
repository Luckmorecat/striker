import { createInterface } from "node:readline";
import { GitCliRepository } from "../../infrastructure/git-cli.js";
import { ShellVerifier } from "../../infrastructure/shell-verifier.js";
import type { AgentSession, AgentRequest } from "../../core/contracts.js";
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
async function execute(
  request: WorkerRequest,
  started: (session: AgentSession) => Promise<void>,
): Promise<unknown> {
  const git = new GitCliRepository();
  const cwd = process.cwd();
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
      return createWorkerRunner().runInNewSession(
        request.request as AgentRequest,
        started,
      );
    case "continue":
      return createWorkerRunner().resumeSession(
        request.session as AgentSession,
        request.instructions,
      );
    case "review":
      return createWorkerRunner().runReviewInNewSession(
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
