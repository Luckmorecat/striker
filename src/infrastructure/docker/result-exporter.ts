import { execFile } from "node:child_process";
import type { RetainedFeatureEnvironment } from "../../core/environment-preparation.js";
import { ResultBranches } from "../result-branches.js";
import { dockerCommand } from "./docker-command.js";

/** Transfer bytes only. Never open the task's Git directory with host Git. */
export function dockerResultExporter(
  environment: RetainedFeatureEnvironment,
  projectRoot: string,
): ResultBranches {
  return new ResultBranches(projectRoot, async (head) => {
    const id = environment.environmentId;
    await dockerCommand(["stop", "--time", "0", id]);
    try {
      await dockerCommand(["start", id]);
      return await new Promise<Buffer>((resolve, reject) => {
        const child = execFile(
          "docker",
          [
            "exec",
            "-i",
            id,
            "git",
            "--no-replace-objects",
            "-C",
            "/workspace",
            "pack-objects",
            "--stdout",
            "--revs",
          ],
          {
            encoding: "buffer",
            maxBuffer: 128 * 1024 * 1024,
          },
          (error, stdout) => {
            if (error)
              reject(
                new Error(
                  "Container commit transfer failed or exceeded 128 MiB; retained certified work is available for export retry",
                  { cause: error },
                ),
              );
            else resolve(stdout);
          },
        );
        child.stdin?.on("error", () => {
          /* Exit supplies the transfer diagnostic. */
        });
        child.stdin?.end(`${head}\n`);
      });
    } finally {
      await dockerCommand(["stop", "--time", "0", id]);
    }
  });
}
