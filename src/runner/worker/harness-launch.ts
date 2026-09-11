import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelSelection } from "../../core/subscription.js";

export async function prepareHarnessLaunch(
  state: string,
  request: ModelSelection & {
    readonly harness: string;
    readonly token: string;
    readonly isolated?: boolean;
  },
) {
  if (request.harness !== "codex" && request.harness !== "pi")
    throw new Error(`Unsupported isolated harness: ${request.harness}`);
  await writeFile(
    path.join(state, "connectivity.json"),
    JSON.stringify(request),
    { mode: 0o600 },
  );
  return {
    command: ["node", "/opt/striker/gateway-bridge.mjs"] as const,
    agent: request.harness === "codex" ? "codex-acp" : "pi-acp",
    acpxOptions:
      request.harness === "codex" ? ["--mcp-config", "/state/mcp.json"] : [],
  };
}
