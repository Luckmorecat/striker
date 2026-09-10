import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { AdapterRegistry } from "../core/adapter-registry.js";
import type { ExecutionEnvironment } from "../core/execution-environment.js";
import { LocalExecutionEnvironment } from "../infrastructure/local-execution-environment.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";
import { createExecutionDispatcher } from "./execution-composition.js";

function fixture() {
  const task = {
    execution: {
      affectedPaths: ["src/task.ts"],
      cwd: "/execution",
      verifyCommand: "check-task",
      workflowInstructions: "implement",
    },
    identity: { id: "01", revision: "revision-1" },
    instructions: "Implement the task.",
    title: "Task",
  };
  const adapters = new AdapterRegistry();
  adapters.register(
    new InMemoryTaskSourceAdapter("memory", [task], {
      "01": { summary: "task complete" },
    }),
  );
  const journal = new InMemoryRunJournal();
  const runner = new FakeAgentRunner(
    [0, 1].map(() => ({
      output: "done",
      session: { id: "session", resumeId: "backend-session" },
      status: "returned" as const,
    })),
  );
  let inspections = 0;
  let exitCode = 0;
  const environment: ExecutionEnvironment = {
    open: () =>
      Promise.resolve({
        runner,
        git: {
          changedPaths: () => Promise.resolve(["src/task.ts"]),
          commitsBetween: () => Promise.resolve(["after"]),
          inspect: () =>
            Promise.resolve({
              dirtyPaths: [],
              head: inspections++ === 0 ? "before" : "after",
              root: "/execution",
              trackedPatch: "",
              untrackedHashes: {},
            }),
          resolveRoot: () => Promise.resolve("/execution"),
          resolvePrivatePath: () => Promise.resolve("/execution/state"),
        },
        verifier: {
          verify: ({ command }) =>
            Promise.resolve({
              command,
              exitCode,
              output: "verification output",
            }),
        },
      }),
  };
  return {
    journal,
    runner,
    setExitCode: (value: number) => {
      exitCode = value;
    },
    open: () =>
      createExecutionDispatcher({
        adapters,
        journal,
        environment,
        request: {
          approvalMode: "attended",
          harness: "codex",
          projectRoot: "/execution",
          stateRoot: "/host/state",
        },
      }),
  };
}

const request = {
  completedTasks: [],
  planId: "plan",
  runId: "run",
  skills: ["project-skill"],
  taskSource: { location: "memory://plan", type: "memory" },
};

describe("execution composition", () => {
  it("certifies a task with the injected execution services", async () => {
    const context = fixture();
    const dispatcher = await context.open();
    await expect(dispatcher.dispatch(request)).resolves.toMatchObject({
      status: "completed",
    });
    expect(context.runner.preflightRequests).toEqual([
      { skills: ["project-skill"] },
    ]);
    expect(context.runner.reviewRequests).toHaveLength(2);
    expect(context.journal.snapshots.at(-1)?.status).toBe("completed");
  });

  it("recovers a verification failure through a newly composed dispatcher", async () => {
    const context = fixture();
    context.setExitCode(1);
    const initial = await context.open();
    await expect(initial.dispatch(request)).resolves.toMatchObject({
      reason: "verification_failed",
      status: "needs_attention",
    });

    context.setExitCode(0);
    const recovered = await context.open();
    await expect(recovered.resume()).resolves.toMatchObject({
      status: "completed",
    });
    expect(context.runner.resumeRequests[0]?.session).toEqual({
      id: "session",
      resumeId: "backend-session",
    });
    expect(context.runner.resumeRequests[0]?.instructions).toContain(
      "verification output",
    );
    expect(context.journal.snapshots.at(-1)?.status).toBe("completed");
  });

  it("propagates an environment opening failure without starting a run", async () => {
    const journal = new InMemoryRunJournal();
    await expect(
      createExecutionDispatcher({
        adapters: new AdapterRegistry(),
        environment: {
          open: () => Promise.reject(new Error("execution unavailable")),
        },
        journal,
        request: {
          approvalMode: "attended",
          harness: "codex",
          projectRoot: "/repo",
          stateRoot: "/state",
        },
      }),
    ).rejects.toThrow("execution unavailable");
    expect(journal.events).toEqual([]);
  });
});

describe("local execution services", () => {
  it("uses local Git and shell services and preserves permission capability errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "striker-composition-"));
    try {
      await promisify(execFile)("git", ["init", root]);
      const environment = new LocalExecutionEnvironment(() =>
        Promise.resolve(undefined),
      );
      const services = await environment.open({
        approvalMode: "auto-review",
        harness: "pi",
        projectRoot: root,
        stateRoot: path.join(root, ".git", "striker"),
      });
      expect(await services.git.resolveRoot(root)).toBe(
        await environment.hostGit.resolveRoot(root),
      );
      await expect(
        services.verifier.verify({
          command: "printf local-output; exit 7",
          cwd: root,
        }),
      ).resolves.toEqual({
        command: "printf local-output; exit 7",
        exitCode: 7,
        output: "local-output",
      });
      await expect(services.runner.preflight({ skills: [] })).rejects.toThrow(
        /auto-review/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
