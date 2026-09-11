import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { acquireProjectOperation } from "./project-operation-lease.js";

test("only one project operation can issue work, and a dead owner can be recovered", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-lock-"));
  try {
    const release = await acquireProjectOperation(root);
    await expect(acquireProjectOperation(root)).rejects.toThrow(
      "operation is active",
    );
    await release();
    await release();
    await mkdir(path.join(root, "operation.lock"));
    await writeFile(
      path.join(root, "operation.lock/owner.json"),
      JSON.stringify({ pid: 2147483647 }),
    );
    const recovered = await acquireProjectOperation(root);
    await expect(acquireProjectOperation(root)).rejects.toThrow(
      "operation is active",
    );
    await recovered();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
