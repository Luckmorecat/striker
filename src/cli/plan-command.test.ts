import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseStrikerPlan } from "../adapters/striker-plan/plan-parser.js";
import type { PlanStatus } from "../core/contracts.js";
import { runCli } from "./program.js";

async function validPlan(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "striker-cli-plan-"));
  await mkdir(path.join(root, "tasks"));
  await Promise.all([
    writeFile(
      path.join(root, "plan.json"),
      JSON.stringify({
        assumptions: {},
        defaults: {},
        taskSource: "striker-plan",
        tasks: ["tasks/01-build.md"],
        version: 2,
      }),
    ),
    writeFile(path.join(root, "spine.md"), "# Spine\n"),
    writeFile(path.join(root, "map.md"), "# Map\n"),
    writeFile(
      path.join(root, "tasks/01-build.md"),
      "# Build it\n\n## Build\n\nBuild it.\n\n## Paths\n\n- src\n\n## Test contract\n\n- CLI\n\n## Verify\n\n```sh\npnpm test\n```\n",
    ),
  ]);
  return root;
}

async function validatePlan(root: string): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["plan", "validate", root], {
    cwd: root,
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planValidator: {
      validate: async (source) => {
        const plan = await parseStrikerPlan(path.resolve(root, source));
        return { taskCount: plan.tasks.length };
      },
    },
    stderr: { write: (text) => (stderr += text) },
    skillInstaller: {
      install: () => Promise.resolve({ changed: false }),
      supportedHarnesses: [],
    },
    stdout: { write: (text) => (stdout += text) },
  });
  return { exitCode, stderr, stdout };
}

describe("striker plan validate", () => {
  it("validates a complete plan through the CLI", async () => {
    const root = await validPlan();
    const result = await validatePlan(root);

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Valid Striker plan: 1 task\n",
    });
  });

  it("rejects a version 1 plan through the CLI", async () => {
    const root = await validPlan();
    const manifestPath = path.join(root, "plan.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 1 }));

    const result = await validatePlan(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid input: expected 2");
  });
});

const status: PlanStatus = {
  activeRun: { attempt: 2, runId: "run-1" },
  assumptions: [
    {
      id: "A1",
      applied: true,
      decision: "accepted",
      locator: {
        commit: "candidate",
        kind: "code",
        line: 42,
        path: "src/cli.ts",
        text: "registerCommands();",
      },
      proposal: "Core now owns command registration.",
      pauseReason: "assumption_disproved",
      reason: "The exact candidate line disproves the assumption.",
      state: "disproved",
      statement: "The CLI owns commands.",
    },
  ],
  attention: {
    detail: "Verification failed.",
    reason: "verification_failed",
  },
  defaults: [{ id: "D1", state: "recorded", statement: "Use text output." }],
  planId: "plan-1",
  reviews: [
    {
      plan: "passed",
      standards: "passed",
      task: { id: "tasks/01.md", revision: "revision-1" },
    },
  ],
  status: "needs_attention",
  tasks: [
    { id: "tasks/01.md", revision: "revision-1", state: "completed" },
    { id: "tasks/02.md", revision: "revision-2", state: "active" },
  ],
};

async function queryPlan(command: "log" | "status") {
  let stdout = "";
  let stderr = "";
  const sources: string[] = [];
  const exitCode = await runCli(["plan", command, "plans/current"], {
    cwd: "/repo",
    permissionConfig: {
      read: () => Promise.resolve("attended"),
      write: () => Promise.resolve(),
    },
    planQueryHandler: {
      log: (source) => {
        sources.push(source);
        return Promise.resolve("# Plan log\n\n## First task\n");
      },
      status: (source) => {
        sources.push(source);
        return Promise.resolve(status);
      },
    },
    planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
    skillInstaller: {
      install: () => Promise.resolve({ changed: false }),
      supportedHarnesses: [],
    },
    stderr: { write: (text) => (stderr += text) },
    stdout: { write: (text) => (stdout += text) },
  });
  return { exitCode, sources, stderr, stdout };
}

describe("striker plan history queries", () => {
  it("renders persistent task and ledger status", async () => {
    const result = await queryPlan("status");

    expect(result).toEqual({
      exitCode: 0,
      sources: ["plans/current"],
      stderr: "",
      stdout:
        "Plan: plan-1\nStatus: needs_attention\nTasks:\n- tasks/01.md@revision-1: completed\n- tasks/02.md@revision-2: active\nActive run: run-1\nAttempt: 2\nAttention: verification_failed: Verification failed.\nReviews:\n- tasks/01.md@revision-1: standards passed, plan passed\nAssumptions:\n- A1: disproved: The CLI owns commands.\n  Proposal: Core now owns command registration.\n  Review: accepted. The exact candidate line disproves the assumption.\n  Transition: applied\n  Pause: assumption_disproved\n  Evidence: src/cli.ts:42 at candidate\nDefaults:\n- D1: recorded: Use text output.\n",
    });
  });

  it("prints the generated chronological log unchanged", async () => {
    const result = await queryPlan("log");

    expect(result).toEqual({
      exitCode: 0,
      sources: ["plans/current"],
      stderr: "",
      stdout: "# Plan log\n\n## First task\n",
    });
  });
});
