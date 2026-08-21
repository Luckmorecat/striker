import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  approvalModes,
  type ApprovalMode,
  type PermissionConfig,
} from "../core/contracts.js";

const localPermissionSchema = z
  .object({ approvalMode: z.enum(approvalModes) })
  .strict();

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class LocalPermissionConfig implements PermissionConfig {
  constructor(private readonly filePath: string) {}

  async read(): Promise<ApprovalMode> {
    try {
      const value = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as unknown;
      return localPermissionSchema.parse(value).approvalMode;
    } catch (error) {
      if (isMissingFile(error)) return "attended";
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot load local permission configuration: ${message}`,
        {
          cause: error,
        },
      );
    }
  }

  async write(approvalMode: ApprovalMode): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(directory, { mode: 0o700, recursive: true });
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ approvalMode }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
