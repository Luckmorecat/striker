import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { featureFixture } from "./feature-fixture.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { CredentialBroker } from "../../src/infrastructure/gateway/credential-broker.js";
import { brokerVersion } from "../../src/infrastructure/gateway/broker-storage.js";
import { parseProjectConfig } from "../../src/config/project-config.js";
import type { RunJournalEvent } from "../../src/core/contracts.js";

export async function recoveryFixture(harness: "codex" | "pi") {
  const fixture = await featureFixture();
  const stateRoot = path.join(fixture.root, "state");
  await mkdir(stateRoot, { mode: 0o700 });
  await writeFile(
    path.join(stateRoot, "prepared-image.json"),
    JSON.stringify(await prepareImage()),
  );
  const run = {
    projectRoot: fixture.source,
    stateRoot,
    packagedRoot: fixture.packagedRoot,
    config: parseProjectConfig({ taskSource: "striker-plan", harness }),
    source: fixture.plan,
    allowDirty: false,
  };
  return { ...fixture, stateRoot, run };
}
export async function fakeBroker(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  url: string,
) {
  const binary = path.join(fixture.root, "fake-broker.mjs");
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import path from 'node:path';
if(process.argv.includes('-h')) { console.log('CLIProxyAPI Version: ${brokerVersion}, test'); process.exit(0); }
const config=JSON.parse(readFileSync(process.argv[process.argv.indexOf('-config')+1], 'utf8'));
if(process.argv.includes('-codex-login')) {writeFileSync(path.join(config['auth-dir'],'test.json'),JSON.stringify({type:'codex'}),{mode:0o600});process.exit(0);}
createServer((req,res)=>{void(async()=>{
 if(req.headers.authorization!=='Bearer '+config['api-keys'][0]) {res.writeHead(401).end();return;}
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'gpt-5.6-sol'}]}));return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const upstream=await fetch(${JSON.stringify(url)},{method:'POST',body:Buffer.concat(chunks),headers:{'content-type':'application/json'}});
 res.writeHead(upstream.status,{'content-type':'text/event-stream'});Readable.fromWeb(upstream.body).pipe(res);
})().catch(()=>res.writeHead(500).end());}).listen(config.port,config.host);
`,
  );
  await chmod(binary, 0o700);
  const broker = new CredentialBroker(path.join(fixture.stateRoot, "broker"));
  await broker.prepare(binary);
  await broker.login();
}

export async function hostCommand(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  action: "run" | "resume" | "retry",
  boundary?: RunJournalEvent["type"],
) {
  const barrier = path.join(fixture.root, "barrier.json");
  const result = path.join(fixture.root, "result.json");
  await rm(barrier, { force: true });
  await rm(result, { force: true });
  const options = path.join(fixture.root, "command.json");
  await writeFile(
    options,
    JSON.stringify({ run: fixture.run, action, boundary, barrier, result }),
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../recovery-host.mjs", import.meta.url)), options],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (value: Buffer) => {
    errors += value.toString();
  });
  const exited = once(child, "exit");
  try {
    for (let i = 0; i < 12000; i++) {
      const event = await readFile(barrier, "utf8").catch(() => "");
      if (event) {
        child.kill("SIGKILL");
        await exited;
        // The supervised broker must release credentials only after its exit.
        await delay(500);
        return {
          event: JSON.parse(event) as RunJournalEvent,
          result: undefined,
        };
      }
      if (child.exitCode !== null) {
        if (child.exitCode !== 0) throw new Error(errors);
        return {
          event: undefined,
          result: JSON.parse(await readFile(result, "utf8")) as {
            status: string;
            reason?: string;
          },
        };
      }
      await delay(50);
    }
    throw new Error("Recovery host did not reach the requested boundary");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

export async function activeFixture(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
) {
  const { FileRunJournal } =
    await import("../../src/infrastructure/file-run-journal.js");
  const journal = new FileRunJournal(fixture.stateRoot);
  const active = await journal.loadActive();
  const snapshot = active?.snapshot;
  const descriptor = snapshot?.request.execution;
  if (!active || !snapshot || !descriptor)
    throw new Error("Missing durable Docker descriptor");
  return {
    journal,
    active,
    snapshot,
    descriptor,
    id: descriptor.environmentId,
    environmentRoot: path.join(
      fixture.stateRoot,
      "environments",
      snapshot.runId,
    ),
  };
}

export async function assertRepeatedReviews(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  planId: string,
  events: readonly (RunJournalEvent | undefined)[],
) {
  const { expect } = await import("vitest");
  const lines = (
    await readFile(
      path.join(fixture.stateRoot, "plans", planId, "events.ndjson"),
      "utf8",
    )
  )
    .trim()
    .split("\n");
  const recorded = lines.map(
    (line) =>
      JSON.parse(line) as { event: { type: string; session?: { id: string } } },
  );
  for (const event of events) {
    if (!event || !("session" in event) || !event.session)
      throw new Error("Missing reviewer identity");
    const id = event.session.id;
    expect(
      recorded.filter(
        (value) =>
          value.event.type === event.type && value.event.session?.id === id,
      ),
    ).toHaveLength(2);
  }
}
