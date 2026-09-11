import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

// A pipe owned by the host closes even on SIGKILL. Retain the credential lease
// until the orphaned broker has exited, so refresh writers can never overlap.
const [binary, config, lock] = process.argv.slice(2);
if (!binary || !config || !lock)
  throw new Error("Missing broker supervision inputs");
const child = spawn(binary, ["-config", config, "-local-model"], {
  stdio: "ignore",
});
let orphaned = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  child.kill("SIGTERM");
  timer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
};
process.stdin.resume();
process.stdin.once("end", () => {
  orphaned = true;
  stop();
});
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
child.once("error", () => {
  process.exitCode = 1;
  process.stdin.destroy();
});
child.once("exit", () => {
  if (timer) clearTimeout(timer);
  process.stdin.destroy();
  if (orphaned) void rm(lock, { recursive: true, force: true });
});
