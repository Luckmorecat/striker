import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FrozenContextResources } from "./context-resources.js";

export async function prepareWorkerResources(
  inputs: string,
  context: FrozenContextResources,
): Promise<void> {
  const worker = path.join(inputs, "worker");
  await mkdir(path.join(worker, "node_modules"), {
    recursive: true,
    mode: 0o700,
  });
  await cp(
    fileURLToPath(new URL("../../../dist", import.meta.url)),
    path.join(worker, "dist"),
    {
      recursive: true,
      filter: (source) =>
        !source.includes(".test.") && !source.includes(`${path.sep}testing`),
    },
  );
  await writeFile(path.join(worker, "package.json"), '{"type":"module"}\n');
  const require = createRequire(import.meta.url);
  await cp(
    path.dirname(require.resolve("zod/package.json")),
    path.join(worker, "node_modules/zod"),
    { recursive: true, dereference: true },
  );
  await symlink(
    "/usr/local/lib/node_modules/acpx",
    path.join(worker, "node_modules/acpx"),
  );
  for (const skill of context.skills) {
    for (const file of skill.files) {
      const target = path.join(inputs, "skills", skill.name, file.path);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(
        target,
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : file.content,
        { mode: file.executable ? 0o700 : 0o600, flag: "wx" },
      );
    }
  }
  await writeFile(path.join(inputs, "context.json"), JSON.stringify(context), {
    mode: 0o600,
    flag: "wx",
  });
}
