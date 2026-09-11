import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import process from "node:process";
const harness = process.env.STRIKER_HARNESS;
const child =
  harness === "codex"
    ? spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(process.env.PI_ACP_PI_COMMAND, ["--mode", "rpc"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
child.stderr.resume();
const send = (value) => child.stdin.write(JSON.stringify(value) + "\n");
const timeout = globalThis.setTimeout(() => {
  child.kill("SIGKILL");
  process.exitCode = 1;
}, 30_000);
let discovered = false;
try {
  if (harness === "codex")
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "striker-test", version: "1" } },
    });
  else send({ id: "skills", type: "get_commands" });
  for await (const line of createInterface({ input: child.stdout })) {
    const message = JSON.parse(line);
    if (harness === "codex" && message.id === 1) {
      assert(!message.error, JSON.stringify(message));
      send({ method: "initialized" });
      send({
        id: 2,
        method: "skills/list",
        params: { cwds: ["/workspace"], forceReload: true },
      });
    } else if (harness === "codex" && message.id === 2) {
      assert(!message.error, JSON.stringify(message));
      const skills = message.result.data
        .flatMap((item) => item.skills)
        .filter((skill) => skill.enabled);
      assert.deepEqual(skills.map((skill) => skill.name).sort(), [
        "chosen",
        "striker-implementor",
      ]);
      discovered = true;
      break;
    } else if (
      harness === "pi" &&
      message.type === "response" &&
      message.command === "get_commands"
    ) {
      assert(message.success, JSON.stringify(message));
      const skills = message.data.commands.filter((command) =>
        command.name.startsWith("skill:"),
      );
      assert.deepEqual(skills.map((skill) => skill.name).sort(), [
        "skill:chosen",
        "skill:striker-implementor",
      ]);
      discovered = true;
      break;
    }
  }
  assert(discovered, "Harness exited before returning its skill catalog");
  assert.equal(
    await readFile("/workspace/AGENTS.md", "utf8"),
    "PRESERVED_REPOSITORY_INSTRUCTIONS",
  );
  await assert.rejects(readFile(process.env.STRIKER_HOST_SENTINEL));
  await assert.rejects(readFile("/workspace/extension-leaked"));
  globalThis.console.log(`${harness}-catalog-ok`);
} finally {
  globalThis.clearTimeout(timeout);
  child.kill("SIGKILL");
}
