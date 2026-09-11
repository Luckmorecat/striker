import { FileRunJournal } from "../infrastructure/file-run-journal.js";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunJournal } from "./contracts.js";
import { expect, it } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import { Dispatcher } from "./dispatcher.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";
import type { ResultExporter } from "./result-export.js";

const before = "a".repeat(40);
const after = "b".repeat(40);
const request = {
  runId: "export-test",
  planId: "export-plan",
  skills: [],
  completedTasks: [],
  taskSource: { type: "memory", location: "memory://plan" },
  execution: {
    backend: "docker",
    recoveryId: "c".repeat(64),
    environmentId: "d".repeat(64),
    imageId: `sha256:${"e".repeat(64)}`,
    sourceHead: before,
    sourceBranch: "main",
  },
} as const;
function fixture(exporter: ResultExporter) {
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner({
    status: "returned",
    session: { id: "task" },
    output: "done",
  });
  const task = {
    identity: { id: "one", revision: "v1" },
    title: "One",
    instructions: "Do one",
    execution: {
      cwd: "/repo",
      affectedPaths: ["one"],
      verifyCommand: "test",
      workflowInstructions: "implement",
    },
  };
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      one: { summary: "done" },
    }),
  );
  let inspections = 0;
  const dependencies = {
    adapters,
    journal,
    runner,
    resultExporter: exporter,
    git: {
      inspect: () =>
        Promise.resolve({
          root: "/repo",
          head: inspections++ === 0 ? before : after,
          dirtyPaths: [],
          trackedPatch: "",
          untrackedHashes: {},
        }),
      changedPaths: () => Promise.resolve(["one"]),
      commitsBetween: () => Promise.resolve([after]),
      resolveRoot: () => Promise.resolve("/repo"),
      resolvePrivatePath: () => Promise.resolve("/private"),
    },
    verifier: {
      verify: () =>
        Promise.resolve({ command: "test", exitCode: 0, output: "ok" }),
    },
  };
  return {
    journal,
    runner,
    dependencies,
    dispatcher: new Dispatcher(dependencies),
  };
}
it("exports durable certified evidence and resumes only export after failure", async () => {
  let fail = true;
  const transfers: unknown[] = [];
  const f = fixture({
    export: (intent) => {
      expect(f.journal.events.at(-1)?.type).toBe(
        fail ? "task_completed" : "result_export_failed",
      );
      transfers.push(intent);
      if (fail) throw new Error("branch changed");
      return Promise.resolve();
    },
  });
  await expect(f.dispatcher.dispatch(request)).rejects.toThrow(
    "branch changed",
  );
  const paused = await f.journal.loadActive();
  expect(paused?.completedTasks).toHaveLength(1);
  expect(paused?.snapshot?.resultExport).toMatchObject({
    branch: "codex/striker-export-test",
    head: null,

    pending: { startCommit: before, resultCommit: after },
  });
  expect(paused?.snapshot?.resultExport?.error).toContain("branch changed");
  fail = false;
  await expect(new Dispatcher(f.dependencies).resume()).resolves.toMatchObject({
    status: "source_exhausted",
  });
  expect(transfers).toHaveLength(2);
  expect(transfers[0]).toEqual(transfers[1]);
  expect(f.runner.requests).toHaveLength(1);
  expect(
    (await f.journal.load(request.planId))?.snapshot?.resultExport,
  ).toMatchObject({ head: after, pending: null, error: null });
});

it("replays certified export intent from disk after a crash before completion append", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-export-journal-"));
  try {
    const f = fixture({ export: () => Promise.resolve() });
    const disk = new FileRunJournal(root);
    let crash = true;
    const journal: RunJournal = {
      load: (id) => disk.load(id),
      loadActive: () => disk.loadActive(),
      append: (event) => {
        if (event.type === "result_export_completed" && crash)
          throw new Error("simulated host crash");
        return disk.append(event);
      },
    };
    await expect(
      new Dispatcher({ ...f.dependencies, journal }).dispatch(request),
    ).rejects.toThrow("simulated host crash");
    await unlink(path.join(root, "plans", request.planId, "snapshot.json"));
    const reopened = new FileRunJournal(root);
    expect(
      (await reopened.loadActive())?.snapshot?.resultExport?.pending
        ?.resultCommit,
    ).toBe(after);
    await expect(
      reopened.append({
        type: "result_export_completed",
        runId: request.runId,
        head: before,
      }),
    ).rejects.toThrow(/pending certified/);
    await expect(
      reopened.append({ type: "run_completed", runId: request.runId }),
    ).rejects.toThrow(/still pending/);
    crash = false;
    await new Dispatcher({ ...f.dependencies, journal: reopened }).resume();
    expect((await reopened.load(request.planId))?.snapshot).toMatchObject({
      status: "completed",
      resultExport: { head: after, pending: null },
    });
    expect(f.runner.requests).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
