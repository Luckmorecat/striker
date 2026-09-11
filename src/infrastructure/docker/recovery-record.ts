import { projectConfigSchema } from "../../config/project-config.js";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RetainedFeatureEnvironment } from "../../core/environment-preparation.js";
import { executionPolicySchema } from "../../permissions/local-execution-config.js";
import { dockerCommand } from "./docker-command.js";

const schema = z
  .object({
    version: z.literal(1),
    plan: z.object({ identity: z.string(), manifest: z.string() }).strict(),
    runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/),
    projectRoot: z.string(),
    harness: z.enum(["codex", "pi"]),
    skills: z.array(z.string()),
    contextId: z.string(),
    inputsId: z.string(),
    containerId: z.string(),
    environment: z
      .object({
        environmentId: z.string().regex(/^[a-f0-9]{64}$/),
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        checkout: z.string(),
        state: z.string(),
        output: z.string(),
        inputs: z.string(),
      })
      .strict(),
    policy: executionPolicySchema,
    selection: z
      .object({
        model: projectConfigSchema.shape.model.unwrap(),
        effort: projectConfigSchema.shape.reasoningEffort.unwrap(),
      })
      .strict(),
    socketPath: z.string(),
    source: z.object({ head: z.string(), branch: z.string() }).strict(),
  })
  .strict();
export type RecoveryRecord = z.infer<typeof schema>;
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function frozenInputsIdentity(
  inputs: string,
  ignored: readonly string[] = ["launch", "reviews"],
): Promise<string> {
  const digest = createHash("sha256");
  async function visit(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      if (directory === inputs && ignored.includes(name)) continue;
      const file = path.join(directory, name);
      const info = await lstat(file);
      digest.update(JSON.stringify([path.relative(inputs, file), info.mode]));
      if (info.isSymbolicLink()) digest.update(await readlink(file));
      else if (info.isDirectory()) await visit(file);
      else if (info.isFile()) digest.update(await readFile(file));
      else throw new Error("Unexpected frozen input resource");
    }
  }
  await visit(inputs);
  return digest.digest("hex");
}
export async function containerIdentity(environmentId: string) {
  const value = JSON.parse(
    await dockerCommand(["inspect", environmentId]).catch(() => {
      throw new Error(
        "Retained container is missing or Docker is unavailable; restore daemon access and the recorded container before recovery",
      );
    }),
  ) as {
    Config: unknown;
    HostConfig: unknown;
    Mounts: { Destination: string }[];
    Image: string;
    State: { OOMKilled: boolean };
  }[];
  const container = value[0];
  if (!container)
    throw new Error(
      "Retained container is missing; restore it or discard the run",
    );
  return {
    identity: hash(
      JSON.stringify([
        container.Config,
        container.HostConfig,
        [...container.Mounts].sort(
          (a: { Destination: string }, b: { Destination: string }) =>
            a.Destination.localeCompare(b.Destination),
        ),
        container.Image,
      ]),
    ),
    oom: container.State.OOMKilled,
  };
}
export async function saveRecoveryRecord(
  value: RecoveryRecord,
): Promise<string> {
  const data = JSON.stringify(schema.parse(value));
  await writeFile(
    path.join(path.dirname(value.environment.inputs), "recovery.json"),
    data,
    { mode: 0o600, flag: "wx" },
  );
  return hash(data);
}
export async function readOwnedRecoveryRecord(
  stateRoot: string,
  runId: string,
  expected: { recoveryId: string; environmentId: string; imageId: string },
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(runId))
    throw new Error("Invalid run identity");
  const root = path.join(await realpath(stateRoot), "environments", runId);
  if ((await realpath(root)) !== root)
    throw new Error("Retained environment path changed");
  const data = await readFile(path.join(root, "recovery.json"), "utf8");
  if (hash(data) !== expected.recoveryId)
    throw new Error(
      "Recorded execution descriptor changed; restore recovery.json",
    );
  const record = schema.parse(JSON.parse(data));
  if (
    record.runId !== runId ||
    record.environment.environmentId !== expected.environmentId ||
    record.environment.imageId !== expected.imageId
  )
    throw new Error("Execution ownership does not match the active journal");
  return { root, record };
}
async function loadRecoveryRecord(
  stateRoot: string,
  runId: string,
  expected: { recoveryId: string; environmentId: string; imageId: string },
) {
  const { root, record } = await readOwnedRecoveryRecord(
    stateRoot,
    runId,
    expected,
  );
  await validatePaths(root, record.environment);
  if (
    (await frozenInputsIdentity(record.environment.inputs)) !== record.inputsId
  )
    throw new Error(
      "Frozen execution files missing or changed; restore the retained inputs",
    );
  const container = await containerIdentity(expected.environmentId);
  if (container.identity !== record.containerId)
    throw new Error(
      "Retained container configuration changed; restore recorded resources",
    );
  await dockerCommand(["image", "inspect", expected.imageId]).catch(() => {
    throw new Error(
      `Recorded image ${expected.imageId} is missing or inaccessible; restore that exact local image before recovery`,
    );
  });
  return { record, oom: container.oom };
}
async function validatePaths(
  root: string,
  environment: RetainedFeatureEnvironment,
) {
  for (const key of ["checkout", "state", "output", "inputs"] as const) {
    const expected = path.join(root, key);
    if (
      environment[key] !== expected ||
      (await realpath(expected)) !== expected ||
      !(await lstat(expected)).isDirectory()
    )
      throw new Error(
        `Retained ${key} directory missing or changed; restore it before recovery`,
      );
  }
  if (!(await lstat(path.join(environment.checkout, ".git"))).isDirectory())
    throw new Error(
      "Retained checkout Git metadata missing; restore the recorded checkout before recovery",
    );
}

export async function readRecoveryRecord(
  ...args: Parameters<typeof loadRecoveryRecord>
) {
  try {
    return await loadRecoveryRecord(...args);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ENOENT")
      throw new Error(
        `Retained execution resource is missing: ${failure.path ?? "recorded artifact"}. Restore that resource from this run before recovery; preparing a new environment cannot replace it.`,
        { cause: error },
      );
    throw error;
  }
}
