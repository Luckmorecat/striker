import { taskPromptText } from "../../runner/task-prompt.js";
import { stageRecord } from "./stage-record.js";
import { parseWorkerRequest } from "../../runner/worker/protocol.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSession, AgentRequest } from "../../core/contracts.js";
import type { RetainedFeatureEnvironment } from "../../core/environment-preparation.js";
import type { RunObserver } from "../../core/run-observation.js";
import type { ModelSelection } from "../../core/subscription.js";
import { prepareHarnessLaunch } from "../../runner/worker/harness-launch.js";
import { callWorker } from "./worker-client.js";
import { dockerCommand } from "./docker-command.js";

type Body = Parameters<typeof callWorker>[0]["request"];
export interface StageExecutorOptions {
  readonly environment: RetainedFeatureEnvironment;
  readonly contextId: string;
  readonly harness: "codex" | "pi";
  readonly observer?: RunObserver;
  readonly selection: ModelSelection;
  readonly token: string;
}

export class StageExecutor {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: StageExecutorOptions) {}

  async execute(
    request: Body,
    started?: (session: AgentSession) => Promise<void>,
  ): Promise<unknown> {
    parseWorkerRequest(JSON.stringify({ ...request, id: randomUUID() }));
    const result = this.pending.then(() => this.perform(request, started));
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async perform(
    request: Body,
    started?: (session: AgentSession) => Promise<void>,
  ): Promise<unknown> {
    const environment = this.options.environment;
    try {
      await dockerCommand(["stop", "--time", "0", environment.environmentId]);
      this.preservedStage(request);
      const stage = await stageRecord(
        environment.inputs,
        this.options.contextId,
        request,
      );
      const { stageId, inputId, record } = stage;
      const home = await this.prepareHome(stageId);
      const command = this.command(stage.original, stageId, home);
      await dockerCommand(["start", environment.environmentId]);
      if (stage.preserved)
        await dockerCommand([
          "exec",
          environment.environmentId,
          "/bin/sh",
          "-c",
          'test -d "$1/acpx" || { echo "Preserved session files missing; explicit retry required" >&2; exit 1; }',
          "striker",
          home,
        ]);
      await dockerCommand([
        "exec",
        environment.environmentId,
        "/bin/mkdir",
        "-p",
        "--",
        home,
      ]);
      const observer = this.options.observer;
      return await callWorker({
        environmentId: environment.environmentId,
        command,
        ...(observer === undefined
          ? {}
          : {
              activity: (activity) => {
                observer.observe({ ...activity, kind: "activity" });
              },
            }),
        request: continuationRequest(request, stage.original),
        ...(started
          ? {
              started: async (session: AgentSession) => {
                const durable = {
                  ...session,
                  execution: {
                    environmentId: environment.environmentId,
                    stageId,
                    inputId,
                  },
                };
                await writeFile(
                  path.join(record, "session.json"),
                  JSON.stringify(durable),
                  { mode: 0o600, flag: "wx" },
                );
                await started(durable);
              },
            }
          : {}),
      });
    } finally {
      await dockerCommand(["stop", "--time", "0", environment.environmentId]);
    }
  }

  private preservedStage(request: Body) {
    const preserved =
      request.operation === "continue" ? request.session.execution : undefined;
    if (
      request.operation === "continue" &&
      preserved?.environmentId !== this.options.environment.environmentId
    )
      throw new Error("Continuation names a different environment");
    return preserved;
  }

  private async prepareHome(stageId: string) {
    const home = path.join(this.options.environment.inputs, "launch", stageId);
    await mkdir(home, { recursive: true, mode: 0o700 });
    await prepareHarnessLaunch(home, {
      ...this.options.selection,
      harness: this.options.harness,
      token: this.options.token,
      isolated: true,
    });
    return `/state/stages/${stageId}`;
  }

  private command(request: Body, stageId: string, home: string): string[] {
    const worker = [
      "node",
      "/opt/striker/gateway-bridge.mjs",
      "node",
      "/opt/striker/run/worker/dist/runner/worker/main.js",
    ];
    const env = [
      "/usr/bin/env",
      `STRIKER_STAGE_HOME=${home}`,
      `STRIKER_LAUNCH_FILE=/opt/striker/run/launch/${stageId}/connectivity.json`,
    ];
    if (request.operation !== "review") return [...env, ...worker];
    return [
      ...env,
      "/opt/striker/restrict-stage",
      `/opt/striker/run/reviews/${stageId}`,
      home,
      "--",
      ...worker,
    ];
  }
}

function continuationRequest(request: Body, original: Body): Body {
  if (request.operation !== "continue") return request;
  if (original.operation === "review")
    return { ...request, instructions: original.instructions };
  if (original.operation !== "implement")
    throw new Error("Preserved session has no agent stage input");
  return {
    ...request,
    instructions: `${taskPromptText(original.request as AgentRequest)}\n\n# Stage continuation\n${request.instructions}`,
  };
}
