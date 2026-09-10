import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type DockerCommand = (args: readonly string[]) => Promise<string>;

export const dockerCommand: DockerCommand = async (args) => {
  const { stdout } = await promisify(execFile)("docker", [...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
};

export async function requireDocker(docker: DockerCommand): Promise<void> {
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch (cause) {
    throw new Error(
      `Docker is unavailable. Install/start Docker and grant daemon access: ${String(cause)}`,
      { cause },
    );
  }
}
