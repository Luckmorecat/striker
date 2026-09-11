import { ExecutionResourceAttention } from "./resource-attention.js";
import { executionLifetime } from "./execution-lifetime.js";
import { rm, realpath } from "node:fs/promises";
import path from "node:path";
import type { ExecutionRunDescriptor } from "../../core/execution-environment.js";
import { parseProjectConfig } from "../../config/project-config.js";
import { LocalExecutionConfig } from "../../permissions/local-execution-config.js";
import { CredentialBroker } from "../gateway/credential-broker.js";
import { openRunConnectivity } from "../gateway/run-connectivity.js";
import { readRecoveryRecord } from "./recovery-record.js";
import { dockerCommand } from "./docker-command.js";
import { StageExecutor } from "./stage-executor.js";
import { dockerExecutionServices } from "./execution-services.js";

export async function reopenDockerExecution(options: {
  readonly stateRoot: string;
  readonly projectRoot: string;
  readonly runId: string;
  readonly descriptor: ExecutionRunDescriptor;
  readonly retry?: boolean;
}) {
  const { record, oom } = await readRecoveryRecord(
    options.stateRoot,
    options.runId,
    options.descriptor,
  );
  if (
    record.projectRoot !== options.projectRoot ||
    record.source.head !== options.descriptor.sourceHead ||
    record.source.branch !== options.descriptor.sourceBranch
  )
    throw new Error("Recorded source ownership differs from this project");
  // Stop orphaned workers before authorizing new connectivity or competing work.
  await dockerCommand([
    "stop",
    "--time",
    "0",
    record.environment.environmentId,
  ]);
  if (oom && !options.retry)
    throw new ExecutionResourceAttention(
      "Retained container exhausted its memory limit. Execution has been stopped; inspect retained files, then run striker retry to start a fresh task thread with the recorded limits.",
    );
  await authorize(options.stateRoot, record);
  const socketDirectory = path.dirname(record.socketPath);
  const stateRoot = await realpath(options.stateRoot);
  if (
    path.dirname(socketDirectory) !== stateRoot ||
    !path.basename(socketDirectory).startsWith("gateway-") ||
    path.basename(record.socketPath) !== "access.sock"
  )
    throw new Error("Recorded gateway path is outside private state");
  // The validated, host-only directory contains only revocable run connectivity.
  await rm(socketDirectory, { recursive: true, force: true });
  const broker = await new CredentialBroker(
    path.join(stateRoot, "broker"),
  ).open();
  const lifetime = executionLifetime(broker);
  lifetime.environment(record.environment.environmentId);
  const close = () => lifetime.close();
  try {
    const connectivity = await openRunConnectivity({
      root: stateRoot,
      socketPath: record.socketPath,
      broker,
      services: record.policy.services ?? [],
      config: parseProjectConfig({
        taskSource: "striker-plan",
        harness: record.harness,
        model: record.selection.model,
        reasoningEffort: record.selection.effort,
      }),
    });
    lifetime.connectivity(connectivity);
    const executor = new StageExecutor({
      environment: record.environment,
      contextId: record.contextId,
      harness: record.harness,
      selection: record.selection,
      token: connectivity.token,
    });
    return {
      services: dockerExecutionServices(
        executor,
        options.projectRoot,
        record.skills,
      ),
      record,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
async function authorize(
  stateRoot: string,
  record: Awaited<ReturnType<typeof readRecoveryRecord>>["record"],
) {
  const policy = await new LocalExecutionConfig(
    path.join(stateRoot, "execution.json"),
  ).read();
  if (
    record.policy.approvedImages.includes(record.environment.imageId) &&
    !policy.approvedImages.includes(record.environment.imageId)
  )
    throw new Error(
      "Recorded image approval was revoked; renew local approval before recovery",
    );
  for (const service of record.policy.services ?? []) {
    if (
      !(policy.services ?? []).some(
        (current) => JSON.stringify(current) === JSON.stringify(service),
      )
    )
      throw new Error(
        `Recorded service grant ${service.name} was revoked or changed; restore its local authorization before recovery`,
      );
  }
}
