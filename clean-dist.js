import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const defaultRoot = fileURLToPath(new globalThis.URL(".", import.meta.url));
const projectRoot = globalThis.process.argv[2] ?? defaultRoot;

await rm(path.resolve(projectRoot, "dist"), {
  force: true,
  recursive: true,
});
