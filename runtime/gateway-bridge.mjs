import { createServer, connect } from "node:net";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { configureHarness } from "./harness-config.mjs";

const home = process.env.STRIKER_STAGE_HOME ?? "/state";
const launch = JSON.parse(
  await readFile(
    process.env.STRIKER_LAUNCH_FILE ?? `${home}/connectivity.json`,
    "utf8",
  ),
);
const sockets = new Set();
const server = createServer((client) => {
  const upstream = connect("/gateway.sock");
  sockets.add(client);
  sockets.add(upstream);
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => {
    sockets.delete(client);
    upstream.destroy();
  });
  upstream.on("close", () => {
    sockets.delete(upstream);
    client.destroy();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const proxy = `http://striker:${launch.token}@127.0.0.1:${server.address().port}`;
await mkdir(home, { recursive: true });
await writeFile(`${home}/proxy-url`, proxy, { mode: 0o600 });
const env = {
  ...process.env,
  HOME: home,
  TMPDIR: home,
  STRIKER_HARNESS: launch.harness,
  ...(launch.isolated && launch.harness === "pi"
    ? { PI_ACP_PI_COMMAND: "/opt/striker/pi-launch.mjs" }
    : {}),
  CODEX_HOME: `${home}/.codex`,
  PI_CODING_AGENT_DIR: `${home}/.pi/agent`,
  STRIKER_GATEWAY_URL: url,
  STRIKER_RUN_KEY: launch.token,
  INITIAL_AGENT_MODE: "agent-full-access",
  HTTP_PROXY: proxy,
  HTTPS_PROXY: proxy,
  http_proxy: proxy,
  https_proxy: proxy,
  NO_PROXY: "localhost,127.0.0.1,::1",
  no_proxy: "localhost,127.0.0.1,::1",
};
await configureHarness(launch, url, home, process.cwd());
const argv = process.argv.slice(2);
if (!argv.length)
  throw new Error("Gateway bridge requires an execution command");
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
const shutdown = (code) => {
  for (const socket of sockets) socket.destroy();
  server.close();
  process.exitCode = code;
};
child.on("error", () => shutdown(1));
child.on("exit", (code) => shutdown(code ?? 1));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
