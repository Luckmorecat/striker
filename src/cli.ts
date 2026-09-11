#!/usr/bin/env node
/// <reference types="node" />

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { StrikerPlanAdapter } from "./adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "./adapters/striker-plan/plan-parser.js";
import { dispatchDockerRun } from "./cli/docker-run.js";
import { commandResult } from "./cli/command-result.js";
import { createExecutionDispatcher } from "./cli/execution-composition.js";
import { createAnswerReader } from "./cli/terminal/answer-reader.js";
import { chooseRecoveryAction } from "./cli/terminal/recovery-actions.js";
import { TerminalSession } from "./cli/terminal/terminal-session.js";
import { runCli } from "./cli/program.js";
import { loadProjectConfig } from "./config/project-config.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import type { ApprovalMode, PermissionConfig } from "./core/contracts.js";
import { RunOperations } from "./core/run-operations.js";
import type { Dispatcher } from "./core/dispatcher.js";
import { PlanQueries } from "./core/plan-queries.js";
import { CredentialBroker } from "./infrastructure/gateway/credential-broker.js";
import { FileRunJournal } from "./infrastructure/file-run-journal.js";
import { createEnvironmentPreparer } from "./infrastructure/docker/environment-preparer.js";
import { LocalExecutionEnvironment } from "./infrastructure/local-execution-environment.js";
import { FilePlanLogReader } from "./infrastructure/plan-projections.js";
import { LocalPermissionConfig } from "./permissions/local-permission-config.js";
import { createPublicSkillInstaller } from "./skills/public-skill-installer.js";

const cwd = process.cwd();
const skillsRoot = fileURLToPath(new URL("../skills", import.meta.url));
const terminal = new TerminalSession(process.stdin, process.stderr);
const environment = new LocalExecutionEnvironment((request) =>
  terminal.permission(request.raw),
);
const git = environment.hostGit;

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
  const active = await new FileRunJournal(stateRoot).loadActive();
  if (active?.snapshot?.request.execution?.backend === "docker")
    throw new Error(
      "This run belongs to Docker execution; local recovery is forbidden",
    );
  const registry = new AdapterRegistry();
  registry.register(
    new StrikerPlanAdapter({
      projectRoot: root,
      workflowRoot: path.join(skillsRoot, "striker-implementor"),
    }),
  );
  return createExecutionDispatcher({
    adapters: registry,
    environment,
    journal: new FileRunJournal(stateRoot),
    request: {
      approvalMode,
      harness: config.harness,
      projectRoot: root,
      stateRoot,
    },
  });
}

async function dispatchRun(
  source: string,
  allowDirty: boolean,
  approvalMode: ApprovalMode,
  backend?: "local" | "docker",
) {
  const root = await git.resolveRoot(cwd);
  const config = await loadProjectConfig(root);
  if (backend === "docker")
    return dispatchDockerRun({
      projectRoot: root,
      stateRoot: await git.resolvePrivatePath(root, "striker"),
      packagedRoot: skillsRoot,
      config,
      source: path.resolve(cwd, source),
      allowDirty,
    });
  const dispatcher = await createDispatcher(approvalMode);
  const sourcePath = path.resolve(cwd, source);
  const plan = await parseStrikerPlan(sourcePath);
  return dispatcher.dispatch({
    allowDirty,
    completedTasks: [],
    planId: plan.identity,
    runId: randomUUID(),
    skills: config.skills,
    taskSource: {
      location: sourcePath,
      type: config.taskSource,
    },
  });
}

async function openPlanQueries(source: string) {
  const root = await git.resolveRoot(cwd);
  const stateRoot = await git.resolvePrivatePath(root, "striker");
  const plan = await parseStrikerPlan(path.resolve(cwd, source));
  const definition = {
    assumptions: Object.entries(plan.manifest.assumptions).map(
      ([id, value]) => ({ id, statement: value.statement }),
    ),
    defaults: Object.entries(plan.manifest.defaults).map(([id, value]) => ({
      id,
      statement: value.statement,
    })),
    planId: plan.identity,
    tasks: plan.tasks.map((task) => task.identity),
  };
  return {
    definition,
    queries: new PlanQueries(
      new FileRunJournal(stateRoot),
      new FilePlanLogReader(stateRoot),
    ),
  };
}

async function credentialBroker() {
  const root = await git.resolveRoot(cwd);
  return new CredentialBroker(
    path.join(await git.resolvePrivatePath(root, "striker"), "broker"),
  );
}

process.exitCode = await runCli(process.argv.slice(2), {
  subscriptionAuthentication: {
    prepare: async (binary, authDirectory) =>
      (await credentialBroker()).prepare(binary, authDirectory),
    login: async () => (await credentialBroker()).login(),
    status: async () => (await credentialBroker()).status(),
  },
  environmentPreparer: {
    prepare: async (approveImage) => {
      const root = await git.resolveRoot(cwd);
      const stateRoot = await git.resolvePrivatePath(root, "striker");
      return createEnvironmentPreparer({
        projectRoot: root,
        stateRoot,
      }).prepare(approveImage);
    },
  },
  answerReader: createAnswerReader(cwd, terminal),
  interaction: {
    get interactive() {
      return terminal.interactive;
    },
    setEnabled: (enabled) => {
      terminal.setEnabled(enabled);
    },
    choose: (context) => chooseRecoveryAction(terminal, context),
  },
  recoveryInspector: {
    inspectRecovery: async () => {
      const root = await git.resolveRoot(cwd);
      const stateRoot = await git.resolvePrivatePath(root, "striker");
      return new RunOperations(new FileRunJournal(stateRoot)).inspectRecovery();
    },
  },
  cwd,
  permissionConfig,
  planQueryHandler: {
    log: async (source) => {
      const { definition, queries } = await openPlanQueries(source);
      return queries.log(definition.planId);
    },
    status: async (source) => {
      const { definition, queries } = await openPlanQueries(source);
      return queries.status(definition);
    },
  },
  planValidator: {
    validate: async (source) => {
      const plan = await parseStrikerPlan(path.resolve(cwd, source));
      return { taskCount: plan.tasks.length };
    },
  },
  runHandler: {
    run: async ({ allowDirty, approvalMode, source, execution }) => {
      const result = await dispatchRun(
        source,
        allowDirty,
        approvalMode,
        execution,
      );
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
      const root = await git.resolveRoot(cwd);
      await new RunOperations(
        new FileRunJournal(await git.resolvePrivatePath(root, "striker")),
      ).discard();
    },
    retry: async () => {
      const dispatcher = await createDispatcher(await permissionConfig.read());
      return commandResult(await dispatcher.retry());
    },
    status: async () => {
      const root = await git.resolveRoot(cwd);
      return new RunOperations(
        new FileRunJournal(await git.resolvePrivatePath(root, "striker")),
      ).status();
    },
  },
  skillInstaller: createPublicSkillInstaller(skillsRoot),
  stderr: process.stderr,
  stdout: process.stdout,
});
