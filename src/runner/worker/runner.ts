import { randomUUID } from "node:crypto";
import { collectFinalMessage } from "../acp-output.js";
import { createAcpRuntime, createRuntimeStore } from "acpx/runtime";
import path from "node:path";
import type { RunObserver } from "../../core/run-observation.js";
import { AcpxAgentRunner, type AcpxRuntimeBoundary } from "../acpx-runner.js";

export function createWorkerRunner(observer?: RunObserver): AcpxAgentRunner {
  const harness = process.env.STRIKER_HARNESS;
  if (harness !== "codex" && harness !== "pi")
    throw new Error("Unsupported isolated harness");
  const agent = `${harness}-acp`;
  const home = process.env.HOME;
  if (!home) throw new Error("Worker state root is missing");
  const runtime = createAcpRuntime({
    cwd: process.cwd(),
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
    sessionStore: createRuntimeStore({ stateDir: path.join(home, "acpx") }),
    agentRegistry: {
      list: () => [agent],
      resolve: () => [harness === "codex" ? "codex-acp" : "pi-acp"],
    },
    ...(harness === "codex"
      ? {
          mcpServers: [
            {
              name: "striker_search",
              command: "node",
              args: ["/opt/striker/search-mcp.mjs"],
              env: [
                {
                  name: "STRIKER_GATEWAY_URL",
                  value: process.env.STRIKER_GATEWAY_URL ?? "",
                },
                {
                  name: "STRIKER_RUN_KEY",
                  value: process.env.STRIKER_RUN_KEY ?? "",
                },
              ],
            },
          ],
        }
      : {}),
  });
  const boundary: AcpxRuntimeBoundary = {
    close: ({ handle, reason }) => runtime.close({ handle, reason }),
    doctor: () => runtime.doctor(),
    ensureSession: async (input) => {
      const handle = await runtime.ensureSession(input);
      if (harness === "codex" && !input.resumeSessionId) {
        // Codex persists its new backend thread only after its first turn.
        // Complete initialization before advertising durable task delivery.
        const turn = runtime.startTurn({
          handle,
          mode: "prompt",
          requestId: randomUUID(),
          text: "STRIKER_SESSION_INITIALIZATION: Reply READY. Task instructions follow in the next message. Do not invoke tools or modify files.",
        });
        const output = collectFinalMessage(turn.events);
        const result = await turn.result;
        await output;
        if (result.status !== "completed")
          throw new Error("Could not initialize a durable Codex session");
      }
      return handle;
    },
    probeAvailability: () => runtime.probeAvailability(),
    startTurn: (input) => runtime.startTurn(input),
  };
  return new AcpxAgentRunner({
    agent,
    approvalMode: "unattended",
    cwd: process.cwd(),
    harness,
    ...(observer === undefined ? {} : { observer }),
    runtime: boundary,
    reviewRuntime: boundary,
  });
}
