import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileRunJournal } from "./file-run-journal.js";
import { ApplyFeature } from "../core/apply-feature.js";
import { Dispatcher } from "../core/dispatcher.js";
import { AdapterRegistry } from "../core/adapter-registry.js";
import {
  FakeAgentRunner,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";

async function complete(journal: FileRunJournal) {
  const task = {
    identity: { id: "one", revision: "v1" },
    title: "One",
    instructions: "Do one",
    execution: {
      cwd: "/repo",
      affectedPaths: ["file"],
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
  const request = {
    runId: "first",
    planId: "plan",
    skills: [],
    completedTasks: [],
    taskSource: { type: "memory", location: "plan" },
    execution: {
      backend: "docker",
      recoveryId: "c".repeat(64),
      environmentId: "d".repeat(64),
      imageId: `sha256:${"e".repeat(64)}`,
      sourceRoot: "/repo",
      sourceHead: "a".repeat(40),
      sourceBranch: "main",
    },
  } as const;
  await new Dispatcher({
    adapters,
    journal,
    runner: new FakeAgentRunner({
      status: "returned",
      session: { id: "task" },
      output: "done",
    }),
    resultExporter: { export: () => Promise.resolve() },
    git: {
      inspect: () =>
        Promise.resolve({
          root: "/repo",
          head: (inspections++ === 0 ? "a" : "b").repeat(40),
          dirtyPaths: [],
          trackedPatch: "",
          untrackedHashes: {},
        }),
      changedPaths: () => Promise.resolve(["file"]),
      commitsBetween: () => Promise.resolve(["b".repeat(40)]),
      resolveRoot: () => Promise.resolve("/repo"),
      resolvePrivatePath: () => Promise.resolve("/private"),
    },
    verifier: {
      verify: () =>
        Promise.resolve({ command: "test", exitCode: 0, output: "ok" }),
    },
  }).dispatch(request);
  return request;
}
it("reopens apply intent after lost completion append, including an older run while a new run is active", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "striker-apply-journal-"));
  try {
    const disk = new FileRunJournal(root);
    const request = await complete(disk);
    await disk.append({
      type: "run_started",
      runId: "second",
      planId: "plan",
      request: {
        ...request,
        runId: "second",
        completedTasks: [{ id: "one", revision: "v1" }],
      },
    });
    let applied = false;
    const command = new ApplyFeature(
      {
        loadRun: (id) => disk.loadRun(id),
        append: (event) => {
          if (event.type === "application_completed")
            throw new Error("journal unavailable");
          return disk.append(event);
        },
      },
      {
        apply: async (_intent, state, record) => {
          expect(state).toBeUndefined();
          await record();
          applied = true;
        },
      },
    );
    await expect(command.apply("first")).rejects.toThrow("journal unavailable");
    expect(applied).toBe(true);
    const reopened = new FileRunJournal(root);
    expect((await reopened.loadRun("first"))?.application?.status).toBe(
      "started",
    );
    await new ApplyFeature(reopened, {
      apply: (_intent, state) => {
        expect(state?.status).toBe("started");
        return Promise.resolve();
      },
    }).apply("first");
    expect((await reopened.loadRun("first"))?.application?.status).toBe(
      "completed",
    );
    expect((await reopened.loadActive())?.snapshot?.runId).toBe("second");
    expect((await reopened.loadActive())?.lastEvent.type).toBe("run_started");
    await expect(
      new ApplyFeature(reopened, { apply: () => Promise.resolve() }).apply(
        "second",
      ),
    ).rejects.toThrow(/completed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
