import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const require = createRequire("/usr/local/lib/node_modules/acpx/package.json");
const { createAcpRuntime, createRuntimeStore } = await import(
  pathToFileURL(require.resolve("acpx/runtime")).href
);
const { harness } = JSON.parse(
  await readFile("/state/connectivity.json", "utf8"),
);
const agent = harness === "codex" ? "codex-acp" : "pi-acp";
const runtime = createAcpRuntime({
  cwd: "/workspace",
  permissionMode: "approve-all",
  nonInteractivePermissions: "deny",
  sessionStore: createRuntimeStore({ stateDir: "/state/acpx" }),
  agentRegistry: { list: () => [agent], resolve: () => [agent] },
  ...(harness === "codex"
    ? JSON.parse(await readFile("/state/mcp.json", "utf8"))
    : {}),
  timeoutMs: 180_000,
});
const sessionKey = randomUUID();
let handle = await runtime.ensureSession({
  agent,
  cwd: "/workspace",
  mode: "persistent",
  sessionKey,
});
async function prompt(text, cancel = false) {
  const turn = runtime.startTurn({
    handle,
    mode: "prompt",
    requestId: randomUUID(),
    text,
  });
  const events = [];
  let cancelled = false;
  const collect = (async () => {
    for await (const event of turn.events) {
      events.push(event);
      if (
        cancel &&
        !cancelled &&
        event.type === "text_delta" &&
        event.stream !== "thought"
      ) {
        cancelled = true;
        await turn.cancel({
          reason: "Explicit authenticated smoke cancellation",
        });
      }
    }
  })();
  const result = await turn.result;
  await collect;
  if (result.status !== (cancel ? "cancelled" : "completed")) {
    // Never print initialization records, provider configuration, or raw errors.
    throw new Error(
      `Expected ${cancel ? "cancelled" : "completed"}; harness returned ${result.status}`,
    );
  }
  return events;
}
try {
  for (const url of ["http://example.com", "https://nodejs.org/en"]) {
    const result = await promisify(execFile)("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "30",
      url,
    ]);
    assert(result.stdout.length > 100, "Public HTTP/HTTPS response was empty");
  }
  process.stdout.write("public-http-https-ok\n");
  const memory = randomUUID();
  const first = await prompt(
    `Remember this conversation-only code: ${memory}. Do not write it to any file or use it in tools. Run the terminal command printf STRIKER_TOOL_OK > /workspace/tool-proof. Then use the striker_search tool to find the current Node.js LTS version on nodejs.org. Finish with the version and a source URL.`,
  );
  assert.equal(
    await readFile("/workspace/tool-proof", "utf8"),
    "STRIKER_TOOL_OK",
  );
  assert(
    first.filter(
      (event) => event.type === "text_delta" && event.stream !== "thought",
    ).length > 1,
    "No streamed output",
  );
  const searchIds = new Set(
    first
      .filter(
        (event) =>
          event.type === "tool_call" &&
          /striker_search|Subscription search/.test(event.title ?? event.text),
      )
      .map((event) => event.toolCallId),
  );
  assert(
    first.some(
      (event) =>
        event.type === "tool_call" &&
        event.status === "completed" &&
        searchIds.has(event.toolCallId),
    ),
    "Search tool did not complete: " +
      JSON.stringify(
        first
          .filter((event) => event.type === "tool_call")
          .map((event) => ({ status: event.status, title: event.title })),
      ),
  );
  assert(
    first.some(
      (event) =>
        event.type === "tool_call" &&
        /https:\/\/[^\s"\\]*nodejs.org/.test(JSON.stringify(event)),
    ),
    "Search returned no useful source URL",
  );
  process.stdout.write("terminal-stream-search-ok\n");
  const resumeSessionId = handle.backendSessionId;
  assert(resumeSessionId, "Missing resumable backend session");
  await runtime.close({ handle, reason: "Exercise retained context" });
  handle = await runtime.ensureSession({
    agent,
    cwd: "/workspace",
    mode: "persistent",
    sessionKey,
    resumeSessionId,
  });
  assert.equal(handle.backendSessionId, resumeSessionId);
  const second = await prompt(
    "What conversation-only code did I tell you to remember? Reply with that code only, without using any tools.",
  );
  const answer = second
    .filter(
      (event) => event.type === "text_delta" && event.stream !== "thought",
    )
    .map((event) => event.text)
    .join("");
  assert(
    answer.includes(memory),
    "Context was not retained across connection close/reopen",
  );
  process.stdout.write("retained-context-ok\n");
  await prompt(
    "Write 2000 numbered sentences about trees. Start immediately, no tools, and continue until all sentences are written.",
    true,
  );
  process.stdout.write("stream-cancellation-ok\n");
} finally {
  await runtime.close({
    handle,
    reason: "Smoke complete",
  });
}
process.stdout.write(`subscription-${harness}-ok\n`);
