import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseWorkerRequest } from "../../runner/worker/protocol.js";
import type { AgentSession } from "../../core/contracts.js";
import type { callWorker } from "./worker-client.js";
import { frozenInputsIdentity } from "./recovery-record.js";

type Body = Parameters<typeof callWorker>[0]["request"];
function identity(request: Body, context: string, snapshotId?: string) {
  return createHash("sha256")
    .update(JSON.stringify({ request, context, snapshotId }))
    .digest("hex");
}
async function openStageRecord(
  inputs: string,
  contextId: string,
  request: Body,
) {
  if (request.operation === "continue")
    return preservedRecord(inputs, contextId, request);
  const stageId = randomUUID();
  const record = path.join(path.dirname(inputs), "stages", stageId);
  await mkdir(record, { recursive: true, mode: 0o700 });
  let snapshotId: string | undefined;
  if (request.operation === "review") {
    const snapshot = path.join(inputs, "reviews", stageId);
    await cp(path.join(path.dirname(inputs), "checkout"), snapshot, {
      recursive: true,
      verbatimSymlinks: true,
    });
    snapshotId = await frozenInputsIdentity(snapshot, []);
  }
  const inputId = identity(request, contextId, snapshotId);
  await writeFile(
    path.join(record, "input.json"),
    JSON.stringify({ request, inputId, contextId, snapshotId }),
    { mode: 0o600, flag: "wx" },
  );
  return { stageId, inputId, record, original: request, preserved: false };
}
async function preservedRecord(
  inputs: string,
  contextId: string,
  request: Extract<Body, { operation: "continue" }>,
) {
  const preserved = request.session.execution;
  if (!preserved)
    throw new Error("Continuation is missing retained stage identity");
  const stageId = preserved.stageId;
  const record = path.join(path.dirname(inputs), "stages", stageId);
  if ((await realpath(record)) !== record)
    throw new Error("Frozen stage path changed");
  const frozen = JSON.parse(
    await readFile(path.join(record, "input.json"), "utf8"),
  ) as {
    request: Body;
    inputId: string;
    contextId: string;
    snapshotId?: string;
  };
  parseWorkerRequest(JSON.stringify({ ...frozen.request, id: randomUUID() }));
  if (
    frozen.contextId !== contextId ||
    frozen.inputId !== preserved.inputId ||
    identity(frozen.request, contextId, frozen.snapshotId) !== preserved.inputId
  )
    throw new Error(
      "Frozen stage resources changed; restore the recorded inputs before resuming",
    );
  const session = JSON.parse(
    await readFile(path.join(record, "session.json"), "utf8"),
  ) as AgentSession;
  if (JSON.stringify(session) !== JSON.stringify(request.session))
    throw new Error(
      "Preserved stage session changed; explicit retry is required",
    );
  if (frozen.request.operation === "review") {
    const snapshot = path.join(inputs, "reviews", stageId);
    if (
      (await realpath(snapshot)) !== snapshot ||
      (await frozenInputsIdentity(snapshot, [])) !== frozen.snapshotId
    )
      throw new Error(
        "Preserved review snapshot is missing or changed; restore it before recovery",
      );
  }
  return {
    stageId,
    inputId: frozen.inputId,
    record,
    original: frozen.request,
    preserved: true,
  };
}

export async function stageRecord(...args: Parameters<typeof openStageRecord>) {
  try {
    return await openStageRecord(...args);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ENOENT")
      throw new Error(
        `Preserved stage resource is missing: ${failure.path ?? "stage artifact"}. Restore its recorded input, session and snapshot; use explicit retry if the session was lost.`,
        { cause: error },
      );
    throw error;
  }
}
