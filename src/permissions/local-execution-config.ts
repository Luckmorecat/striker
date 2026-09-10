import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const resourceLimitsSchema = z
  .object({
    cpus: z.number().positive().default(4),
    memoryMiB: z.number().int().positive().default(8192),
    pids: z.number().int().positive().default(512),
  })
  .strict();

const schema = z
  .object({
    approvedImages: z
      .array(z.string().regex(/^sha256:[a-f0-9]{64}$/))
      .default([]),
    resources: resourceLimitsSchema.prefault({}),
  })
  .strict();
export type ExecutionPolicy = z.infer<typeof schema>;

export class LocalExecutionConfig {
  constructor(private readonly filePath: string) {}

  async read(): Promise<ExecutionPolicy> {
    try {
      return schema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        return schema.parse({});
      throw new Error(
        `Cannot load local execution configuration: ${String(cause)}`,
        { cause },
      );
    }
  }

  async write(value: ExecutionPolicy): Promise<void> {
    const policy = schema.parse(value);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.filePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
