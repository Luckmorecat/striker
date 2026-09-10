import { once } from "node:events";
import { createServer, request } from "node:http";
import { expect, test } from "vitest";
import { NetworkPolicy } from "./network-policy.js";
import { RunGateway } from "./run-gateway.js";

test("HTTP proxy connects only to the pinned named exception and rechecks redirect destinations", async () => {
  const target = createServer((_request, response) => {
    response.writeHead(302, { location: "http://169.254.169.254/private" });
    response.end("allowed-service");
  }).listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const gateway = new RunGateway({
    brokerUrl: "http://127.0.0.1:1",
    brokerKey: "secret",
    model: "selected",
    effort: "low",
    networkPolicy: new NetworkPolicy([
      { name: "service.example", port: address.port, addresses: ["127.0.0.1"] },
    ]),
  });
  const access = await gateway.listen();
  const proxy = (url: string, authorized = true) =>
    new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        access.url,
        {
          path: url,
          headers: {
            "proxy-authorization": authorized
              ? `Basic ${Buffer.from(`striker:${access.token}`).toString("base64")}`
              : "wrong",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode);
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
  try {
    expect(await proxy(`http://service.example:${String(address.port)}/`)).toBe(
      302,
    );
    expect(await proxy("http://169.254.169.254/private")).toBe(403);
    expect(await proxy(`http://127.0.0.1:${String(address.port)}/`)).toBe(403);
    expect(
      await proxy(`http://service.example:${String(address.port)}/`, false),
    ).toBe(407);
  } finally {
    await gateway.close();
    target.closeAllConnections();
    await new Promise<void>((resolve) =>
      target.close(() => {
        resolve();
      }),
    );
  }
});
