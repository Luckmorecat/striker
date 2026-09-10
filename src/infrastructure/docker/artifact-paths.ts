import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function allocateArtifactPaths(stateRoot: string, runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(runId))
    throw new Error("Invalid run ID");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const privateRoot = await realpath(stateRoot);
  if (privateRoot.includes(","))
    throw new Error("Docker artifact paths cannot contain commas");
  const environments = path.join(privateRoot, "environments");
  await mkdir(environments, { mode: 0o700 }).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  });
  const info = await lstat(environments);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Artifact parent must be a directory, never a symlink");
  if ((info.mode & 0o077) !== 0)
    throw new Error("Artifact parent must be private (mode 0700)");
  const root = path.join(environments, runId);
  await mkdir(root, { mode: 0o700 });
  const paths = {
    root,
    checkout: path.join(root, "checkout"),
    state: path.join(root, "state"),
    output: path.join(root, "output"),
  };
  await Promise.all(
    [paths.checkout, paths.state, paths.output].map((directory) =>
      mkdir(directory, { mode: 0o700 }),
    ),
  );
  return paths;
}
