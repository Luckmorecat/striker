import { isIP } from "node:net";
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

export const executionPolicySchema = z
  .object({
    backend: z.enum(["local", "docker"]).optional(),
    approvedImages: z
      .array(z.string().regex(/^sha256:[a-f0-9]{64}$/))
      .default([]),
    resources: resourceLimitsSchema.prefault({}),
    services: z
      .array(
        z
          .object({
            name: z
              .string()
              .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
              .refine((name) => !isIP(name)),
            port: z.number().int().min(1).max(65535),
            addresses: z
              .array(z.string().refine((address) => isIP(address) !== 0))
              .min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export class LocalExecutionConfig {
  constructor(private readonly filePath: string) {}

  async select(backend?: "local" | "docker"): Promise<"local" | "docker"> {
    const policy = await this.read();
    if (backend !== undefined) await this.write({ ...policy, backend });
    return backend ?? policy.backend ?? "docker";
  }

  async read(): Promise<ExecutionPolicy> {
    try {
      return executionPolicySchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        return executionPolicySchema.parse({});
      throw new Error(
        `Cannot load local execution configuration: ${String(cause)}`,
        { cause },
      );
    }
  }

  async write(value: ExecutionPolicy): Promise<void> {
    const policy = executionPolicySchema.parse(value);
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
