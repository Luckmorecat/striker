import { parseWorkerRequest } from "../../runner/worker/protocol.js";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSession } from "../../core/contracts.js";
import type { RetainedFeatureEnvironment } from "../../core/environment-preparation.js";
import type { ModelSelection } from "../../core/subscription.js";
import { prepareHarnessLaunch } from "../../runner/worker/harness-launch.js";
import { callWorker } from "./worker-client.js";
import { dockerCommand } from "./docker-command.js";

type Body = Parameters<typeof callWorker>[0]["request"];
export interface StageExecutorOptions {
  readonly environment: RetainedFeatureEnvironment;
  readonly contextId: string;
  readonly harness: "codex" | "pi";
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
      const preserved = this.preservedStage(request);
      const stageId = preserved?.stageId ?? randomUUID();
      const inputId = createHash("sha256")
        .update(JSON.stringify({ request, context: this.options.contextId }))
        .digest("hex");
      const root = path.dirname(environment.inputs);
      const record = path.join(root, "stages", stageId);
      await mkdir(record, { recursive: true, mode: 0o700 });
      if (preserved) {
        const frozen = JSON.parse(
          await readFile(path.join(record, "input.json"), "utf8"),
        ) as { inputId: string; contextId: string };
        if (
          frozen.inputId !== preserved.inputId ||
          frozen.contextId !== this.options.contextId
        )
          throw new Error("Frozen stage resources changed");
      } else
        await writeFile(
          path.join(record, "input.json"),
          JSON.stringify({
            request,
            inputId,
            contextId: this.options.contextId,
          }),
          { mode: 0o600, flag: "wx" },
        );
      const home = await this.prepareHome(stageId);
      const command = await this.command(request, stageId, home);
      await dockerCommand(["start", environment.environmentId]);
      await dockerCommand([
        "exec",
        environment.environmentId,
        "/bin/mkdir",
        "-p",
        "--",
        home,
      ]);
      return await callWorker({
        environmentId: environment.environmentId,
        command,
        request,
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

  private async command(
    request: Body,
    stageId: string,
    home: string,
  ): Promise<string[]> {
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
    const snapshot = path.join(
      this.options.environment.inputs,
      "reviews",
      stageId,
    );
    await cp(this.options.environment.checkout, snapshot, {
      recursive: true,
      verbatimSymlinks: true,
    });
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
