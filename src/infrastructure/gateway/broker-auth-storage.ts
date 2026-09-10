import { chmod, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const recordSchema = z.object({
  type: z.literal("codex"),
  last_refresh: z.string().optional(),
  expired: z.string().optional(),
});

/** Read only broker records; never translate native harness credential files. */
export async function readBrokerAuth(file: string) {
  try {
    if (!(await lstat(file)).isFile()) throw new Error("Not a regular file");
    const record = recordSchema.parse(JSON.parse(await readFile(file, "utf8")));
    await chmod(file, 0o600);
    return record;
  } catch {
    throw new Error(
      "Invalid broker-owned Codex subscription record. Use striker auth login with a dedicated broker auth directory; native harness auth files are unsupported.",
    );
  }
}

export async function brokerAuthFiles(directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  for (const name of names) await readBrokerAuth(path.join(directory, name));
  return names;
}
