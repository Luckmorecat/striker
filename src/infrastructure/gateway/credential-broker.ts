import { brokerAuthFiles, readBrokerAuth } from "./broker-auth-storage.js";
import { acquireBrokerLease } from "./broker-lease.js";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SubscriptionAuthentication } from "../../core/subscription.js";
import {
  brokerConfiguration,
  prepareBroker,
  readBroker,
} from "./broker-storage.js";
import { startBrokerProcess, unusedLoopbackPort } from "./broker-process.js";

export class CredentialBroker implements SubscriptionAuthentication {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  prepare(binary: string, authDirectory?: string): Promise<void> {
    return prepareBroker(this.root, binary, authDirectory);
  }

  async status(): Promise<{ ready: boolean }> {
    const descriptor = await readBroker(this.root);
    return {
      ready: (await brokerAuthFiles(descriptor.authDirectory)).length > 0,
    };
  }

  async login(): Promise<void> {
    const descriptor = await readBroker(this.root);
    const release = await acquireBrokerLease(descriptor.authDirectory);
    try {
      await this.performLogin(descriptor.binary, descriptor.authDirectory);
    } finally {
      await release();
    }
  }

  private async performLogin(
    binary: string,
    authDirectory: string,
  ): Promise<void> {
    const config = path.join(this.root, "login.json");
    await writeFile(
      config,
      JSON.stringify(
        brokerConfiguration(
          authDirectory,
          0,
          randomBytes(32).toString("base64url"),
        ),
      ),
      { mode: 0o600 },
    );
    const child = spawn(
      binary,
      ["-config", config, "-codex-login", "-no-browser"],
      { cwd: this.root, stdio: "inherit" },
    );
    const [code] = (await once(child, "exit")) as [number | null];
    if (code !== 0 || !(await this.status()).ready)
      throw new Error(
        "Subscription login did not complete; rerun striker auth login",
      );
  }

  async open() {
    const descriptor = await readBroker(this.root);
    if (!(await this.status()).ready)
      throw new Error("Subscription login required: run striker auth login");
    const release = await acquireBrokerLease(descriptor.authDirectory);
    try {
      return await this.start(descriptor, release);
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async start(
    descriptor: Awaited<ReturnType<typeof readBroker>>,
    release: () => Promise<void>,
  ) {
    const directory = await mkdtemp(path.join(this.root, "session-"));
    const key = randomBytes(32).toString("base64url");
    const managementKey = randomBytes(32).toString("base64url");
    const port = await unusedLoopbackPort();
    const url = `http://127.0.0.1:${String(port)}`;
    const config = path.join(directory, "config.json");
    await writeFile(
      config,
      JSON.stringify(brokerConfiguration(descriptor.authDirectory, port, key)),
      { mode: 0o600 },
    );
    try {
      const running = await startBrokerProcess(
        descriptor,
        config,
        url,
        key,
        managementKey,
      );
      return {
        url,
        key,
        models: () => this.models(url, key),
        refresh: () =>
          this.refresh(url, managementKey, descriptor.authDirectory),
        close: async () => {
          try {
            await running.close();
          } finally {
            await rm(directory, { recursive: true, force: true });
            await release();
          }
        },
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async models(url: string, key: string): Promise<readonly string[]> {
    const response = await fetch(`${url}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error("Broker model catalog unavailable");
    const body = (await response.json()) as { data?: { id: string }[] };
    if (!Array.isArray(body.data))
      throw new Error("Broker model catalog is invalid");
    return body.data.map(({ id }) => id);
  }

  private async refresh(
    url: string,
    key: string,
    directory: string,
  ): Promise<void> {
    const names = await brokerAuthFiles(directory);
    if (!names.length) throw new Error("Broker login is missing");
    for (const name of names) {
      const file = path.join(directory, name);
      const before = await readBrokerAuth(file);
      const response = await fetch(`${url}/v0/management/auth-files/refresh`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(
          "Broker subscription refresh failed; another login may be required",
        );
      const after = await readBrokerAuth(file);
      if (
        after.last_refresh === before.last_refresh ||
        !(Date.parse(after.expired ?? "") > Date.now())
      )
        throw new Error("Broker did not persist refreshed subscription state");
    }
  }
}
