import { expect, test } from "vitest";
import { NetworkPolicy } from "./network-policy.js";

test("pins public destinations and rejects any forbidden DNS answer", async () => {
  const policy = new NetworkPolicy([], (host) =>
    Promise.resolve(
      host === "public.example"
        ? ["93.184.216.34"]
        : ["93.184.216.34", "127.0.0.1"],
    ),
  );
  expect(await policy.destination("http://public.example/page")).toEqual({
    hostname: "public.example",
    address: "93.184.216.34",
    port: 80,
  });
  await expect(policy.destination("https://rebound.example/")).rejects.toThrow(
    "destination",
  );
  for (const address of [
    "127.1",
    "2130706433",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[fc00::1]",
    "[2002:7f00:1::]",
  ]) {
    await expect(policy.destination(`http://${address}/`)).rejects.toThrow(
      "destination",
    );
  }
});

test("local named exceptions grant only pinned addresses and ports", async () => {
  const policy = new NetworkPolicy(
    [{ name: "database.example", port: 8443, addresses: ["10.0.0.8"] }],
    () => Promise.resolve(["127.0.0.1"]),
  );
  expect(await policy.destination("https://database.example:8443/")).toEqual({
    hostname: "database.example",
    address: "10.0.0.8",
    port: 8443,
  });
  await expect(policy.destination("https://database.example/")).rejects.toThrow(
    "destination",
  );
  await expect(policy.destination("https://10.0.0.8:8443/")).rejects.toThrow(
    "destination",
  );
  await expect(policy.destination("ftp://public.example/")).rejects.toThrow(
    "destination",
  );
  await expect(
    policy.destination("https://user:pass@public.example/"),
  ).rejects.toThrow("destination");
});

test("blocks the host's public interfaces literally and through aliases", async () => {
  const policy = new NetworkPolicy(
    [],
    () => Promise.resolve(["93.184.216.34"]),
    () => ["93.184.216.34", "2606:4700:4700::1111"],
  );
  for (const host of [
    "93.184.216.34",
    "host-alias.example",
    "[2606:4700:4700::1111]",
  ]) {
    await expect(policy.destination(`https://${host}/`)).rejects.toThrow(
      "destination",
    );
  }
});
