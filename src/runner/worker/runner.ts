import { createAcpRuntime, createRuntimeStore } from "acpx/runtime";
import path from "node:path";
import { AcpxAgentRunner, type AcpxRuntimeBoundary } from "../acpx-runner.js";

export function createWorkerRunner(): AcpxAgentRunner {
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
    ensureSession: (input) => runtime.ensureSession(input),
    probeAvailability: () => runtime.probeAvailability(),
    startTurn: (input) => runtime.startTurn(input),
  };
  return new AcpxAgentRunner({
    agent,
    approvalMode: "unattended",
    cwd: process.cwd(),
    harness,
    runtime: boundary,
    reviewRuntime: boundary,
  });
}
