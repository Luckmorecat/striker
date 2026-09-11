import path from "node:path";
import { isolatedContext } from "./context-config.mjs";
import { mkdir, writeFile } from "node:fs/promises";

export async function configureHarness(
  launch,
  url,
  home = "/state",
  cwd = "/workspace",
) {
  const context = launch.isolated
    ? await isolatedContext(home, cwd)
    : undefined;
  if (launch.harness === "codex") {
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(
      path.join(home, ".codex/config.toml"),
      [
        `model = ${JSON.stringify(launch.model)}`,
        `model_reasoning_effort = ${JSON.stringify(launch.effort)}`,
        'model_provider = "striker"',
        'web_search = "disabled"',
        "[model_providers.striker]",
        'name = "Striker"',
        `base_url = ${JSON.stringify(url + "/v1")}`,
        'wire_api = "responses"',
        "requires_openai_auth = false",
        `experimental_bearer_token = ${JSON.stringify(launch.token)}`,
        ...(context?.codex ?? []),
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(home, "mcp.json"),
      JSON.stringify({
        mcpServers: [
          {
            name: "striker_search",
            command: "node",
            args: ["/opt/striker/search-mcp.mjs"],
            env: [
              { name: "STRIKER_GATEWAY_URL", value: url },
              { name: "STRIKER_RUN_KEY", value: launch.token },
            ],
          },
        ],
      }),
      { mode: 0o600 },
    );
  } else if (launch.harness === "pi") {
    await mkdir(path.join(home, ".pi/agent"), { recursive: true });
    await writeFile(
      path.join(home, ".pi/agent/models.json"),
      JSON.stringify({
        providers: {
          striker: {
            baseUrl: url + "/v1",
            api: "openai-responses",
            apiKey: launch.token,
            models: [
              {
                id: launch.model,
                name: "Striker subscription",
                reasoning: true,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(home, ".pi/agent/settings.json"),
      JSON.stringify({
        defaultProvider: "striker",
        defaultModel: launch.model,
        defaultThinkingLevel: launch.effort,
        extensions: ["/opt/striker/pi-search.mjs"],
      }),
    );
    if (context)
      await writeFile(
        path.join(home, "pi-args.json"),
        JSON.stringify(context.piArgs),
        { mode: 0o600 },
      );
  } else throw new Error("Unsupported isolated harness");
}
