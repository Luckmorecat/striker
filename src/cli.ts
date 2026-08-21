#!/usr/bin/env node
/// <reference types="node" />

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { AcpPermissionRequest } from "acpx/runtime";

import { StrikerPlanAdapter } from "./adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "./adapters/striker-plan/plan-parser.js";
import { runCli } from "./cli/program.js";
import { loadProjectConfig } from "./config/project-config.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { Dispatcher } from "./core/dispatcher.js";
import { FileRunJournal } from "./infrastructure/file-run-journal.js";
import { GitCliRepository } from "./infrastructure/git-cli.js";
import { ShellVerifier } from "./infrastructure/shell-verifier.js";
import { createAcpxAgentRunner } from "./runner/acpx-runner.js";
import { createPublicSkillInstaller } from "./skills/public-skill-installer.js";

const cwd = process.cwd();
const skillsRoot = fileURLToPath(new URL("../skills", import.meta.url));
const git = new GitCliRepository();

async function relayPermission(request: AcpPermissionRequest) {
  if (!process.stdin.isTTY) return { outcome: "reject_once" } as const;
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await prompt.question(
      `Codex requests permission: ${JSON.stringify(request.raw)}\nAllow once? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y"
      ? ({ outcome: "allow_once" } as const)
      : ({ outcome: "reject_once" } as const);
  } finally {
    prompt.close();
  }
}

async function dispatchRun(source: string, allowDirty: boolean) {
  const root = await git.resolveRoot(cwd);
  const config = await loadProjectConfig(root);
  const stateRoot = await git.resolvePrivatePath(root, "striker");
  await mkdir(stateRoot, { mode: 0o700, recursive: true });
  const registry = new AdapterRegistry();
  registry.register(
    new StrikerPlanAdapter({
      projectRoot: root,
      workflowRoot: path.join(skillsRoot, "striker-implementor"),
    }),
  );
  const dispatcher = new Dispatcher({
    adapters: registry,
    git,
    journal: new FileRunJournal(stateRoot),
    runner: createAcpxAgentRunner({
      cwd: root,
      harness: config.harness,
      permissionRelay: relayPermission,
      stateDir: path.join(stateRoot, "acpx"),
    }),
    verifier: new ShellVerifier(),
  });
  return dispatcher.dispatch({
    allowDirty,
    completedTasks: [],
    runId: randomUUID(),
    skills: config.skills,
    taskSource: {
      location: path.resolve(cwd, source),
      type: config.taskSource,
    },
  });
}

process.exitCode = await runCli(process.argv.slice(2), {
  cwd,
  planValidator: {
    validate: async (source) => {
      const plan = await parseStrikerPlan(path.resolve(cwd, source));
      return { taskCount: plan.tasks.length };
    },
  },
  runHandler: {
    run: async ({ allowDirty, source }) => {
      const result = await dispatchRun(source, allowDirty);
      if (result.status === "source_exhausted") {
        return {
          message: "Striker plan has no remaining tasks.",
          status: "completed",
        };
      }
      if (result.status === "completed") {
        return {
          message: `Completed ${result.task.identity.id}.`,
          status: "completed",
        };
      }
      if (result.status === "needs_attention") {
        return {
          message: `Run needs attention: ${result.reason}.`,
          status: "needs_attention",
        };
      }
      return { message: `Run failed: ${result.error}.`, status: "failed" };
    },
  },
  skillInstaller: createPublicSkillInstaller(skillsRoot),
  stderr: process.stderr,
  stdout: process.stdout,
});
