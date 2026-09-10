import {
  request,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NetworkPolicy } from "./network-policy.js";

function headers(input: IncomingMessage["headers"]): OutgoingHttpHeaders {
  const omitted = new Set([
    "connection",
    "proxy-authorization",
    "proxy-authenticate",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "host",
    ...(input.connection ?? "")
      .toLowerCase()
      .split(",")
      .map((item) => item.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !omitted.has(key)),
  );
}

export async function forwardHttp(
  incoming: IncomingMessage,
  response: ServerResponse,
  policy: NetworkPolicy,
): Promise<void> {
  const url = new URL(incoming.url ?? "");
  if (url.protocol !== "http:") {
    response.writeHead(403).end();
    return;
  }
  let destination;
  try {
    destination = await policy.destination(url.href);
  } catch {
    response.writeHead(403).end();
    return;
  }
  if (response.destroyed) return;
  const outgoing = request({
    hostname: destination.address,
    port: destination.port,
    method: incoming.method,
    path: `${url.pathname}${url.search}`,
    agent: false,
    headers: { ...headers(incoming.headers), host: url.host },
  });
  response.once("close", () => outgoing.destroy());
  outgoing.once("response", (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, headers(upstream.headers));
    void pipeline(upstream, response).catch(() => response.destroy());
  });
  outgoing.once("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  await pipeline(incoming, outgoing);
}

export async function forwardConnect(
  incoming: IncomingMessage,
  client: Duplex,
  head: Buffer,
  policy: NetworkPolicy,
): Promise<void> {
  const target = incoming.url ?? "";
  let destination;
  try {
    const url = new URL(`https://${target}`);
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !target.endsWith(`:${url.port || "443"}`)
    )
      throw new Error("Invalid CONNECT");
    destination = await policy.destination(url.href);
  } catch {
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  if (client.destroyed) return;
  const upstream = connect({
    host: destination.address,
    port: destination.port,
  });
  client.once("close", () => upstream.destroy());
  client.once("error", () => upstream.destroy());
  upstream.once("error", () => client.destroy());
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
}
