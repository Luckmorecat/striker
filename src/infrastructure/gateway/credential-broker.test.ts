import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CredentialBroker } from "./credential-broker.js";
import { brokerVersion } from "./broker-storage.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-broker-test-"));
  const binary = path.join(root, "fake-broker.mjs");
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
if (process.argv.includes('-h')) { console.log('CLIProxyAPI Version: ${brokerVersion}, test'); process.exit(0); }
const config = JSON.parse(readFileSync(process.argv[process.argv.indexOf('-config') + 1], 'utf8'));
const file = path.join(config['auth-dir'], 'subscription.json');
if (process.argv.includes('-codex-login')) { writeFileSync(file, JSON.stringify({type:'codex',last_refresh:'2020-01-01',expired:'2020-01-02'}), {mode:0o600}); process.exit(0); }
createServer((req,res) => {
 const management = req.url.startsWith('/v0/management/');
 if (req.headers.authorization !== 'Bearer ' + (management ? process.env.MANAGEMENT_PASSWORD : config['api-keys'][0])) {res.writeHead(401).end(); return;}
 if (req.url === '/v1/models') { res.end(JSON.stringify({data:[{id:'selected'}]})); return; }
 if (req.url === '/v0/management/auth-files/refresh') {writeFileSync(file,JSON.stringify({type:'codex',last_refresh:new Date().toISOString(),expired:new Date(Date.now()+3600000).toISOString()})); res.end('{}'); return;}
 res.writeHead(404).end();
}).listen(config.port,config.host);
`,
  );
  await chmod(binary, 0o700);
  return {
    root,
    binary,
    broker: new CredentialBroker(path.join(root, "prepared")),
  };
}

it("requires explicit preparation/login and detects changed executable pins", async () => {
  const { root, binary, broker } = await fixture();
  try {
    await expect(broker.open()).rejects.toThrow(/auth prepare/);
    await broker.prepare(binary);
    expect(await broker.status()).toEqual({ ready: false });
    await expect(broker.open()).rejects.toThrow(/auth login/);
    expect((await stat(path.join(root, "prepared"))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(path.join(root, "prepared/broker.json"))).mode & 0o777,
    ).toBe(0o600);
    await writeFile(path.join(root, "prepared/cli-proxy-api"), "changed");
    await expect(broker.status()).rejects.toThrow(/changed/);
    await writeFile(
      binary,
      '#!/bin/sh\necho "CLIProxyAPI Version: wrong, test"\n',
    );
    await expect(broker.prepare(binary)).rejects.toThrow(/does not match/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps authentication and refresh management on the host and closes its listener", async () => {
  const { root, binary, broker } = await fixture();
  try {
    await broker.prepare(binary);
    await broker.login();
    const lease = await broker.open();
    try {
      expect(await lease.models()).toEqual(["selected"]);
      await expect(broker.open()).rejects.toThrow(/already in use/);
      await expect(broker.login()).rejects.toThrow(/already in use/);
      const response = await fetch(
        `${lease.url}/v0/management/auth-files/refresh`,
        { method: "POST", headers: { authorization: `Bearer ${lease.key}` } },
      );
      expect(response.status).toBe(401);
      await response.body?.cancel();
      await lease.refresh();
      expect(
        await readFile(
          path.join(root, "prepared/auth/subscription.json"),
          "utf8",
        ),
      ).not.toContain("2020-01-01");
    } finally {
      await lease.close();
    }
    await expect(fetch(`${lease.url}/v1/models`)).rejects.toThrow();
    const next = await broker.open();
    expect(next.key).not.toBe(lease.key);
    await lease.close();
    await expect(broker.open()).rejects.toThrow(/already in use/);
    await next.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects native or malformed credential records without including their contents in diagnostics", async () => {
  const { root, binary, broker } = await fixture();
  try {
    await broker.prepare(binary);
    const file = path.join(root, "prepared/auth/auth.json");
    for (const contents of [
      '{"tokens":{"access_token":"secret"}}',
      '{"access_token":"secret"',
    ]) {
      await writeFile(file, contents);
      await expect(broker.status()).rejects.toThrow(
        "native harness auth files are unsupported",
      );
      try {
        await broker.status();
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
