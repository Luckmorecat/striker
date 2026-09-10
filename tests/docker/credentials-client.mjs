import assert from "node:assert/strict";
import { request } from "node:http";
import process from "node:process";

const call = (target, body, token = process.env.RUN_KEY) =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath: "/gateway.sock",
        path: target,
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, text }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify(body));
  });
const body = { model: "selected", input: [], stream: true };
assert.equal(
  (await call("/v1/responses", body, "foreign-run-key")).status,
  401,
);
assert.equal((await call("/v0/management/auth-files", {})).status, 404);
assert.equal((await call("/codex-login", {})).status, 404);
assert.equal(
  (await call("/v1/responses", { ...body, model: "unavailable" })).status,
  400,
);
assert.equal(
  (
    await call("/v1/responses", {
      ...body,
      tools: [{ type: "mcp", server_url: "http://private/" }],
    })
  ).status,
  400,
);
const error = await call("/v1/responses", body);
assert.equal(error.status, 502);
assert.equal(error.text, "");
globalThis.console.log("gateway-credentials-boundary-ok");
