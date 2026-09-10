import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

/** One writer per broker-owned credential store, including imported stores. */
export async function acquireBrokerLease(authDirectory: string) {
  const lock = path.join(authDirectory, ".striker-broker-lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      "Broker credentials are already in use. Stop the owning Striker process; after a crash, verify no broker remains before removing .striker-broker-lock from its auth directory.",
    );
  }
  let released: Promise<void> | undefined;
  return () => (released ??= rm(lock, { recursive: true, force: true }));
}
