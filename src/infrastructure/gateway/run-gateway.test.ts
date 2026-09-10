import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, test } from "vitest";
import { RunGateway } from "./run-gateway.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

test("run access forwards only the selected model with trusted authentication", async () => {
  const upstream = createServer((request, response) => {
    expect(request.headers.authorization).toBe("Bearer broker-secret");
    expect(request.headers["x-upstream-url"]).toBeUndefined();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"type":"response.completed"}\n\n');
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanup.push(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) =>
      upstream.close(() => {
        resolve();
      }),
    );
  });
  const address = upstream.address();
  if (address === null || typeof address === "string")
    throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    brokerKey: "broker-secret",
    model: "gpt-5.6-sol",
    effort: "low",
  });
  const access = await gateway.listen();
  cleanup.push(() => gateway.close());
  const response = await fetch(`${access.url}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access.token}`,
      "x-upstream-url": "http://evil.invalid",
    },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      max_output_tokens: 4096,
      client_metadata: { "x-codex-session-id": "probe-session" },
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("response.completed");
  const denied = await fetch(`${access.url}/v0/management/auth-files`, {
    headers: { authorization: `Bearer ${access.token}` },
  });
  expect(denied.status).toBe(404);
});

test("rejects foreign run keys, model changes, and remote tool capabilities", async () => {
  const gateway = new RunGateway({
    brokerUrl: "http://127.0.0.1:1/v1/responses",
    brokerKey: "secret",
    model: "gpt-5.6-sol",
    effort: "low",
  });
  const access = await gateway.listen();
  cleanup.push(() => gateway.close());
  const send = (token: string, body: unknown) =>
    fetch(`${access.url}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  expect(
    (await send("another-run", { model: "gpt-5.6-sol", input: [] })).status,
  ).toBe(401);
  expect((await send(access.token, { model: "other", input: [] })).status).toBe(
    400,
  );
  expect(
    (
      await send(access.token, {
        model: "gpt-5.6-sol",
        input: [],
        tools: [{ type: "mcp", server_url: "http://localhost/private" }],
      })
    ).status,
  ).toBe(400);
});

test("subscription search requires a completed search and returns cited sources", async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          output: [
            { type: "web_search_call", status: "completed" },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Node release",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://nodejs.org/en/download",
                      title: "Node.js",
                    },
                  ],
                },
              ],
            },
          ],
        },
      })}\n\n`,
    );
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanup.push(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) =>
      upstream.close(() => {
        resolve();
      }),
    );
  });
  const address = upstream.address();
  if (address === null || typeof address === "string")
    throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    brokerKey: "secret",
    model: "gpt-5.6-sol",
    effort: "low",
  });
  const access = await gateway.listen();
  cleanup.push(() => gateway.close());
  const response = await fetch(`${access.url}/v1/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${access.token}` },
    body: JSON.stringify({ query: "Node LTS" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    text: "Node release",
    sources: [{ url: "https://nodejs.org/en/download", title: "Node.js" }],
  });
});

test("cancellation closes the upstream stream and revocation rejects further use", async () => {
  let upstreamClosed: Promise<unknown> | undefined;
  const upstream = createServer((_request, response) => {
    upstreamClosed = once(response, "close");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: streaming\n\n");
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanup.push(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) =>
      upstream.close(() => {
        resolve();
      }),
    );
  });
  const address = upstream.address();
  if (address === null || typeof address === "string")
    throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    brokerKey: "secret",
    model: "gpt-5.6-sol",
    effort: "low",
  });
  const access = await gateway.listen();
  cleanup.push(() => gateway.close());
  const send = () =>
    fetch(`${access.url}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${access.token}` },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [], stream: true }),
    });
  const response = await send();
  const reader = response.body?.getReader();
  expect(new TextDecoder().decode((await reader?.read())?.value)).toContain(
    "streaming",
  );
  await reader?.cancel();
  await upstreamClosed;
  gateway.revoke();
  expect((await send()).status).toBe(401);
});

test("rejects an oversized search stream before EOF and closes the upstream", async () => {
  let closed: Promise<unknown> | undefined;
  const upstream = createServer((_request, response) => {
    closed = once(response, "close");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(Buffer.alloc(2 * 1024 * 1024 + 1, "x"));
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanup.push(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => {
      upstream.close(() => {
        resolve();
      });
    });
  });
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    brokerKey: "secret",
    model: "selected",
    effort: "low",
  });
  const access = await gateway.listen();
  cleanup.push(() => gateway.close());
  const response = await fetch(`${access.url}/v1/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${access.token}` },
    body: JSON.stringify({ query: "query" }),
  });
  expect(response.status).toBe(502);
  await closed;
});
