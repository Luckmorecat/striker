import { forwardHttp, forwardConnect } from "./egress.js";
import type { NetworkPolicy } from "./network-policy.js";
import type { Socket } from "node:net";
import { searchRequest, searchResult } from "./subscription-search.js";
import { modelRequest } from "./model-request.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

export interface RunGatewayOptions {
  readonly networkPolicy?: NetworkPolicy;
  readonly brokerUrl: string;
  readonly brokerKey: string;
  readonly model: string;
  readonly effort: string;
}

/** One instance owns one run's access. Only the host constructs these options. */
export class RunGateway {
  private readonly token = randomBytes(32).toString("base64url");
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  private readonly requests = new Set<AbortController>();
  private revoked = false;

  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: RunGatewayOptions) {
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("connect", (request, socket, head) => {
      if (!this.proxyAuthorized(request) || !options.networkPolicy) {
        socket.end(
          "HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n",
        );
        return;
      }
      void forwardConnect(request, socket, head, options.networkPolicy).catch(
        () => socket.destroy(),
      );
    });
  }

  private proxyAuthorized(request: IncomingMessage): boolean {
    const expected = `Basic ${Buffer.from(`striker:${this.token}`).toString("base64")}`;
    return this.matches(request.headers["proxy-authorization"], expected);
  }

  private matches(value: string | undefined, expected: string): boolean {
    const supplied = Buffer.from(value ?? "");
    const target = Buffer.from(expected);
    return (
      !this.revoked &&
      supplied.length === target.length &&
      timingSafeEqual(supplied, target)
    );
  }

  async listen(socketPath?: string): Promise<{ url: string; token: string }> {
    if (socketPath) this.server.listen(socketPath);
    else this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (address === null) throw new Error("Gateway did not bind");
    if (typeof address === "string") return { url: address, token: this.token };
    return {
      url: `http://127.0.0.1:${String(address.port)}`,
      token: this.token,
    };
  }

  revoke(): void {
    this.revoked = true;
    for (const controller of this.requests) controller.abort();
    for (const socket of this.sockets) socket.destroy();
  }

  async close(): Promise<void> {
    this.revoke();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server.close(() => {
        resolve();
      }),
    );
  }

  private authorized(request: IncomingMessage): boolean {
    return this.matches(request.headers.authorization, `Bearer ${this.token}`);
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (/^https?:\/\//.test(request.url ?? "")) {
      if (!this.proxyAuthorized(request) || !this.options.networkPolicy) {
        response.writeHead(407).end();
        return;
      }
      await forwardHttp(request, response, this.options.networkPolicy);
      return;
    }
    if (!this.authorized(request)) {
      response.writeHead(401).end();
      return;
    }
    if (
      request.method !== "POST" ||
      !["/v1/responses", "/v1/search"].includes(request.url ?? "")
    ) {
      response.writeHead(404).end();
      return;
    }
    await this.handleModel(request, response);
  }

  private async handleModel(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const value = await this.readBody(request, response);
    if (response.writableEnded || response.destroyed || this.revoked) return;
    const search = request.url === "/v1/search";
    const body = (search ? searchRequest : modelRequest)(
      value,
      this.options.model,
      this.options.effort,
    );
    if (body === undefined) {
      response.writeHead(400).end();
      return;
    }
    await this.forward(body, response, search);
  }

  private async readBody(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 4 * 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      response.writeHead(400).end();
      return;
    }
  }

  private async forward(
    body: Record<string, unknown>,
    response: ServerResponse,
    search: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    this.requests.add(controller);
    response.once("close", () => {
      controller.abort();
    });
    try {
      const upstream = await fetch(this.options.brokerUrl, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.brokerKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!upstream.ok || upstream.body === null) {
        response.writeHead(502).end();
        return;
      }
      if (search) {
        const result = await searchResult(upstream);
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result));
        return;
      }
      response.writeHead(200, {
        "content-type":
          upstream.headers.get("content-type") ?? "text/event-stream",
      });
      await pipeline(
        Readable.fromWeb(
          upstream.body as unknown as ReadableStream<Uint8Array>,
        ),
        response,
      );
    } finally {
      this.requests.delete(controller);
    }
  }
}
