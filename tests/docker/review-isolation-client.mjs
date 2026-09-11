import assert from "node:assert/strict";
import { readFile, writeFile, rename, chmod, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
assert.equal(
  await readFile("/review/candidate", "utf8"),
  "protected-candidate",
);
for (const file of ["/workspace/secret", "/proc/1/root/workspace/secret"]) {
  await assert.rejects(readFile(file));
}
for (const file of ["/review/candidate", "/proc/self/root/review/candidate"]) {
  await assert.rejects(writeFile(file, "overwritten"));
}
await assert.rejects(rename("/review/candidate", "/scratch/stolen"));
await assert.rejects(chmod("/review/candidate", 0o777));
await assert.rejects(writeFile("/review/candidate", "overwritten"));
await symlink("/workspace", "/scratch/alias");
await assert.rejects(readFile("/scratch/alias/secret"));
assert.throws(() =>
  execFileSync("sh", ["-c", "echo overwritten > /review/candidate"], {
    stdio: "pipe",
  }),
);
await writeFile("/scratch/success", "writable");
assert.equal(await readFile("/scratch/success", "utf8"), "writable");
globalThis.console.log("review-isolation-ok");
