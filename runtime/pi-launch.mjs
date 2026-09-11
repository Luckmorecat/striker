#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
const args = JSON.parse(
  await readFile(`${process.env.HOME}/pi-args.json`, "utf8"),
);
const child = spawn("pi", [...args, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  process.exitCode = 1;
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
