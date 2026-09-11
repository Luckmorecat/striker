import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

const schema = z
  .object({
    version: z.number().int().positive(),
    baseImage: z.string().min(1),
    packages: z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/)),
    commands: z.array(z.string().min(1)),
  })
  .strict();

export async function loadBaseline() {
  const root = fileURLToPath(new URL("../../../runtime/", import.meta.url));
  const files = await Promise.all(
    [
      "baseline.json",
      "Dockerfile",
      "restrict-stage.c",
      "context-config.mjs",
      "pi-launch.mjs",
      "install.mjs",
      "probe.mjs",
      ".dockerignore",
      "gateway-bridge.mjs",
      "harness-config.mjs",
      "pi-search.mjs",
      "search-mcp.mjs",
    ].map((name) => readFile(path.join(root, name), "utf8")),
  );
  const manifest = schema.parse(JSON.parse(files[0] ?? ""));
  const identity = createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex");
  return { root, manifest, identity, tag: `striker-baseline:${identity}` };
}
