import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function ownerAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** The lock covers validation, orphan quiescence, execution and journal writes. */
export async function acquireProjectOperation(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, "operation.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    await reclaimDeadOwner(lock);
    await mkdir(lock, { mode: 0o700 });
  }
  await writeFile(
    path.join(lock, "owner.json"),
    JSON.stringify({ pid: process.pid }),
    { mode: 0o600, flag: "wx" },
  );
  let released: Promise<void> | undefined;
  return () => (released ??= rm(lock, { recursive: true }));
}

async function reclaimDeadOwner(lock: string) {
  const unavailable = new Error(
    "A Striker project operation is active or its owner cannot be verified; stop the owner before recovery. If it crashed before recording ownership, inspect and remove operation.lock explicitly.",
  );
  let owner: { pid: number };
  try {
    owner = JSON.parse(
      await readFile(path.join(lock, "owner.json"), "utf8"),
    ) as { pid: number };
  } catch {
    throw unavailable;
  }
  if (ownerAlive(owner.pid)) throw unavailable;
  // Only one contender may reclaim a dead owner's directory.
  try {
    await mkdir(path.join(lock, "reclaim"));
  } catch {
    throw unavailable;
  }
  const current = JSON.parse(
    await readFile(path.join(lock, "owner.json"), "utf8"),
  ) as { pid: number };
  if (current.pid !== owner.pid || ownerAlive(current.pid)) throw unavailable;
  await rm(lock, { recursive: true });
}
