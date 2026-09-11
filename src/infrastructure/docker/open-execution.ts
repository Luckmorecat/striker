import { executionLifetime } from "./execution-lifetime.js";
import {
  saveRecoveryRecord,
  frozenInputsIdentity,
  containerIdentity,
} from "./recovery-record.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProjectConfig } from "../../config/project-config.js";
import { LocalExecutionConfig } from "../../permissions/local-execution-config.js";
import { CredentialBroker } from "../gateway/credential-broker.js";
import { openRunConnectivity } from "../gateway/run-connectivity.js";
import { DockerEnvironment } from "./docker-environment.js";
import { resolveContextResources } from "./context-resources.js";
import { prepareWorkerResources } from "./worker-resources.js";
import {
  exportSourceCheckout,
  initializeCheckout,
} from "./independent-checkout.js";
import { dockerCommand } from "./docker-command.js";
import { dockerExecutionServices } from "./execution-services.js";
import { StageExecutor } from "./stage-executor.js";
import { loadBaseline } from "./baseline.js";

interface DockerOpenOptions {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly runId: string;
  readonly plan: { readonly identity: string; readonly manifest: string };
  readonly packagedRoot: string;
  readonly config: ProjectConfig;
}

export async function openDockerExecution(options: DockerOpenOptions) {
  const { config, stateRoot } = options;
  if (config.harness !== "codex" && config.harness !== "pi")
    throw new Error("Docker execution supports only Codex and Pi");
  const { image, context, policy } = await prepareExecution(options);
  const broker = await new CredentialBroker(
    path.join(stateRoot, "broker"),
  ).open();
  const lifetime = executionLifetime(broker);
  const close = () => lifetime.close();
  try {
    const connectivity = await openRunConnectivity({
      root: stateRoot,
      broker,
      config,
      services: policy.services ?? [],
    });
    lifetime.connectivity(connectivity);
    const environment = await new DockerEnvironment().allocate({
      stateRoot,
      runId: options.runId,
      image,
      resources: policy.resources,
      gateway: connectivity,
    });
    const environmentId = environment.environmentId;
    lifetime.environment(environmentId);
    const source = await exportSourceCheckout(
      options.projectRoot,
      environment.inputs,
    );
    await prepareWorkerResources(environment.inputs, context);
    await dockerCommand(["start", environmentId]);
    await initializeCheckout(environment);
    await dockerCommand(["stop", "--time", "0", environmentId]);
    const recoveryId = await saveRecoveryRecord({
      version: 1,
      plan: options.plan,
      runId: options.runId,
      projectRoot: options.projectRoot,
      harness: config.harness,
      skills: [...config.skills],
      contextId: context.identity,
      inputsId: await frozenInputsIdentity(environment.inputs),
      containerId: (await containerIdentity(environment.environmentId))
        .identity,
      environment,
      policy,
      selection: connectivity.selection,
      socketPath: connectivity.socketPath,
      source,
    });
    const executor = new StageExecutor({
      environment,
      contextId: context.identity,
      harness: config.harness,
      selection: connectivity.selection,
      token: connectivity.token,
    });
    return {
      recoveryId,
      services: dockerExecutionServices(
        executor,
        options.projectRoot,
        config.skills,
      ),
      environment,
      source,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function prepareExecution(options: DockerOpenOptions) {
  const { config, stateRoot } = options;
  const image = z
    .object({ imageId: z.string(), baselineId: z.string() })
    .strict()
    .parse(
      JSON.parse(
        await readFile(path.join(stateRoot, "prepared-image.json"), "utf8"),
      ),
    );
  if (image.baselineId !== (await loadBaseline()).identity)
    throw new Error(
      "Run striker environment prepare for the current baseline first",
    );
  const context = await resolveContextResources({
    packagedRoot: options.packagedRoot,
    projectRoot: options.projectRoot,
    skills: config.skills,
  });
  const policy = await new LocalExecutionConfig(
    path.join(stateRoot, "execution.json"),
  ).read();
  if (config.image) {
    const selected = await dockerCommand([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      config.image,
    ]);
    if (selected !== image.imageId || !policy.approvedImages.includes(selected))
      throw new Error(
        "Selected image changed or lacks local approval; run environment prepare --approve-image",
      );
  }
  return { image, context, policy };
}
