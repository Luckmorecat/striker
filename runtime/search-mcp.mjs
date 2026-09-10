import { createInterface } from "node:readline";
import process from "node:process";
const controllers = new Map();
const tool = {
  name: "striker_search",
  description:
    "Search the public web through the subscription broker and return cited sources.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
};
async function handle(request) {
  if (request.method === "initialize")
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "striker-search", version: "1" },
    };
  if (request.method === "tools/list") return { tools: [tool] };
  if (request.method !== "tools/call" || request.params?.name !== tool.name)
    throw new Error("Unsupported search operation");
  const controller = new globalThis.AbortController();
  controllers.set(request.id, controller);
  try {
    const response = await globalThis.fetch(
      `${process.env.STRIKER_GATEWAY_URL}/v1/search`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.STRIKER_RUN_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.params.arguments),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error("Subscription search failed");
    return {
      content: [{ type: "text", text: JSON.stringify(await response.json()) }],
    };
  } finally {
    controllers.delete(request.id);
  }
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === "notifications/cancelled") {
    controllers.get(request.params?.requestId)?.abort();
    return;
  }
  if (request.id === undefined) return;
  void handle(request)
    .then((result) => {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
      );
    })
    .catch(() => {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: "Subscription search failed" },
        }) + "\n",
      );
    });
});
input.on("close", () => {
  for (const controller of controllers.values()) controller.abort();
});
