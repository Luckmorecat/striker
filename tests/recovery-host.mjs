import { readFile, writeFile } from "node:fs/promises";
import { FileRunJournal } from "../dist/infrastructure/file-run-journal.js";
import { dispatchDockerRun } from "../dist/cli/docker-run.js";
import { recoverDockerRun } from "../dist/cli/docker-recovery.js";
const options = JSON.parse(await readFile(globalThis.process.argv[2], "utf8"));
const original = FileRunJournal.prototype.append;
FileRunJournal.prototype.append = async function (event) {
  await original.call(this, event);
  if (event.type === options.boundary) {
    await writeFile(options.barrier, JSON.stringify(event));
    await new Promise(() => {
      /* Test barrier: parent kills this host. */
    });
  }
};
try {
  const result =
    options.action === "run"
      ? await dispatchDockerRun(options.run)
      : await recoverDockerRun({ ...options.run, action: options.action });
  await writeFile(options.result, JSON.stringify(result));
} catch (error) {
  globalThis.console.error(
    error instanceof Error ? error.message : String(error),
  );
  globalThis.process.exitCode = 1;
}
