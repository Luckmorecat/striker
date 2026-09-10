import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { request, createServer } from "node:http";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import process from "node:process";

const proxyAuth = `Basic ${Buffer.from(`striker:${process.env.RUN_KEY}`).toString("base64")}`;
const call = (target, authorization = proxyAuth, method = "GET") =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath: "/gateway.sock",
        path: target,
        method,
        headers: { "proxy-authorization": authorization },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    outgoing.on("connect", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
assert.equal(await call(process.env.SERVICE_URL), 200);
assert.equal(await call(process.env.SERVICE_URL, "wrong"), 407);
for (const host of [
  "127.0.0.1",
  "169.254.169.254",
  "host.docker.internal",
  "[::1]",
  "[::ffff:127.0.0.1]",
]) {
  assert.equal(await call(`http://${host}/`), 403);
}
assert.equal(await call("169.254.169.254:443", proxyAuth, "CONNECT"), 403);
await new Promise((resolve, reject) => {
  const socket = connect({ host: "1.1.1.1", port: 443 });
  socket.setTimeout(1500, () => {
    socket.destroy();
    resolve();
  });
  socket.once("error", resolve);
  socket.once("connect", () => {
    socket.destroy();
    reject(new Error("Direct egress escaped"));
  });
});
for (const path of [process.env.HOST_SENTINEL, "/var/run/docker.sock"])
  await assert.rejects(readFile(path));
const internal = createServer((_request, response) =>
  response.end("internal-service"),
).listen(0, "127.0.0.1");
await new Promise((resolve) => internal.once("listening", resolve));
const response = await globalThis.fetch(
  `http://127.0.0.1:${internal.address().port}`,
);
assert.equal(await response.text(), "internal-service");
await new Promise((resolve) => internal.close(resolve));
globalThis.console.log("gateway-network-boundary-ok");
