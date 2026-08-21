#!/usr/bin/env node
/// <reference types="node" />

import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { AcpPermissionRequest } from "acpx/runtime";

import { StrikerPlanAdapter } from "./adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "./adapters/striker-plan/plan-parser.js";
import { runCli } from "./cli/program.js";
import { loadProjectConfig } from "./config/project-config.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import type {
  ApprovalMode,
  DispatchResult,
  PermissionConfig,
  RunCommandResult,
} from "./core/contracts.js";
import { Dispatcher } from "./core/dispatcher.js";
import { FileRunJournal } from "./infrastructure/file-run-journal.js";
import { GitCliRepository } from "./infrastructure/git-cli.js";
import { ShellVerifier } from "./infrastructure/shell-verifier.js";
import { LocalPermissionConfig } from "./permissions/local-permission-config.js";
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

async function permissionFilePath(): Promise<string> {
  const root = await git.resolveRoot(cwd);
  const stateRoot = await git.resolvePrivatePath(root, "striker");
  return path.join(stateRoot, "permissions.json");
}

const permissionConfig: PermissionConfig = {
  read: async () =>
    new LocalPermissionConfig(await permissionFilePath()).read(),
  write: async (mode) =>
    new LocalPermissionConfig(await permissionFilePath()).write(mode),
};

async function createDispatcher(
  approvalMode: ApprovalMode,
): Promise<Dispatcher> {
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
  return new Dispatcher({
    adapters: registry,
    git,
    journal: new FileRunJournal(stateRoot),
    runner: createAcpxAgentRunner({
      approvalMode,
      cwd: root,
      harness: config.harness,
      permissionRelay: relayPermission,
      stateDir: path.join(stateRoot, "acpx"),
    }),
    verifier: new ShellVerifier(),
  });
}

async function dispatchRun(
  source: string,
  allowDirty: boolean,
  approvalMode: ApprovalMode,
) {
  const root = await git.resolveRoot(cwd);
  const config = await loadProjectConfig(root);
  const dispatcher = await createDispatcher(approvalMode);
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

function commandResult(result: DispatchResult): RunCommandResult {
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
    const commands =
      result.reason === "session_resume_failed"
        ? "Run `striker retry` to start a fresh attempt."
        : "Run `striker answer`, `striker resume`, or `striker retry`.";
    return {
      message: `Run needs attention: ${result.reason}. ${commands}`,
      status: "needs_attention",
    };
  }
  return {
    message: `Run failed: ${result.error}. Run \`striker retry\` or \`striker discard --force\`.`,
    status: "failed",
  };
}

async function readAnswer(file: string | undefined): Promise<string> {
  if (file !== undefined) return readFile(path.resolve(cwd, file), "utf8");
  let answer = "";
  for await (const chunk of process.stdin) answer += String(chunk);
  return answer;
}

process.exitCode = await runCli(process.argv.slice(2), {
  answerReader: { read: readAnswer },
  cwd,
  permissionConfig,
  planValidator: {
    validate: async (source) => {
      const plan = await parseStrikerPlan(path.resolve(cwd, source));
      return { taskCount: plan.tasks.length };
    },
  },
  runHandler: {
    run: async ({ allowDirty, approvalMode, source }) => {
      const result = await dispatchRun(source, allowDirty, approvalMode);
      return commandResult(result);
    },
  },
  recoveryHandler: {
    answer: async (answer) => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      return commandResult(await dispatcher.answer(answer));
    },
    resume: async () => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      return commandResult(await dispatcher.resume());
    },
  },
  operationHandler: {
    discard: async () => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      await dispatcher.discard();
    },
    retry: async () => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      return commandResult(await dispatcher.retry());
    },
    status: async () => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      return dispatcher.status();
    },
  },
  skillInstaller: createPublicSkillInstaller(skillsRoot),
  stderr: process.stderr,
  stdout: process.stdout,
});
