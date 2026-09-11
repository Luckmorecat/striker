import { execFile, type ExecFileException } from "node:child_process";

/** No inherited Git redirects/config, hooks, replacements, lazy fetch or maintenance. */
function startGit(
  root: string,
  args: readonly string[],
  callback: (error: ExecFileException | null, stdout: string) => void,
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const child = execFile(
    "git",
    [
      "--no-optional-locks",
      "--no-replace-objects",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "gc.auto=0",
      "-c",
      "maintenance.auto=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "core.commitGraph=false",
      "-c",
      "fetch.writeCommitGraph=false",
      "-C",
      root,
      ...args,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_NO_LAZY_FETCH: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
    callback,
  );
  child.stdin?.on("error", () => {
    /* Process exit supplies the diagnostic. */
  });
  return child;
}
export function resultGit(
  root: string,
  args: readonly string[],
  input?: Uint8Array | string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = startGit(root, args, (error, stdout) => {
      if (error) reject(new Error(error.message, { cause: error }));
      else resolve(stdout.trim());
    });
    child.stdin?.end(input);
  });
}
/** Verify ref types while Git holds both locks, then commit the ref mutation. */
export function resultTransaction(
  root: string,
  updates: string,
  verify: () => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let prepared = false;
    let output = "";
    const child = startGit(root, ["update-ref", "--stdin"], (error) => {
      if (failure) reject(failure);
      else if (error) reject(new Error(error.message, { cause: error }));
      else resolve();
    });
    child.stdout?.on("data", (data: Buffer | string) => {
      output += data.toString();
      if (prepared || !output.includes("prepare: ok\n")) return;
      prepared = true;
      void verify().then(
        () => child.stdin?.end("commit\n"),
        (error: unknown) => {
          failure = error instanceof Error ? error : new Error(String(error));
          child.stdin?.end("abort\n");
        },
      );
    });
    child.stdin?.write(`start\noption no-deref\n${updates}prepare\n`);
  });
}
export async function resultRef(
  root: string,
  ref: string,
): Promise<string | null> {
  const entry = await resultGit(root, [
    "for-each-ref",
    "--format=%(refname) %(objectname) %(symref)",
    ref,
  ]);
  const exact = entry.split("\n").find((line) => line.startsWith(`${ref} `));
  if (!exact) return null;
  const [, head, symbolic] = exact.split(" ");
  if (symbolic)
    throw new Error(
      "Result ref is symbolic; restore its direct branch ownership",
    );
  if (!head) throw new Error("Result ref has no object identity");
  return head;
}
