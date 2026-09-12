#!/usr/bin/env node
/// <reference types="node" />
import { readExecutionStatus } from "./cli/execution-status.js";
import { LocalExecutionConfig } from "./permissions/local-execution-config.js";
import { warnLocalExecution } from "./cli/execution-warning.js";
import { CleanupFeature } from "./core/cleanup-feature.js";
import { DockerFeatureResources } from "./infrastructure/docker/feature-resources.js";

import { ApplyFeature } from "./core/apply-feature.js";
import { ApplyResult } from "./infrastructure/apply-result.js";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { StrikerPlanAdapter } from "./adapters/striker-plan/striker-plan-adapter.js";
import { parseStrikerPlan } from "./adapters/striker-plan/plan-parser.js";
import { recoverDockerRun } from "./cli/docker-recovery.js";
import { acquireProjectOperation } from "./infrastructure/project-operation-lease.js";
import { dispatchDockerRun } from "./cli/docker-run.js";
import { commandResult } from "./cli/command-result.js";
import { createExecutionDispatcher } from "./cli/execution-composition.js";
import { createAnswerReader } from "./cli/terminal/answer-reader.js";
import { chooseRecoveryAction } from "./cli/terminal/recovery-actions.js";
import { TerminalSession } from "./cli/terminal/terminal-session.js";
import {
  planPanelSeed,
  recoveryProgressContext,
  RunProgress,
} from "./cli/ui/run-progress.js";
import { FileRunHistoryReader } from "./infrastructure/run-history-reader.js";
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
const progress = new RunProgress(terminal, () => {
  process.kill(process.pid, "SIGINT");
});
const environment = new LocalExecutionEnvironment(
  (request) => progress.prompt(() => terminal.permission(request.raw)),
  progress.observer,
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
    observers: progress,
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
  const selected = await new LocalExecutionConfig(
    path.join(await git.resolvePrivatePath(root, "striker"), "execution.json"),
  ).select(backend);
  process.stdout.write(`Execution: ${selected}.\n`);
  const stateRoot = await git.resolvePrivatePath(root, "striker");
  if (selected === "docker")
    return progress.run({ backend: "docker" }, () =>
      dispatchDockerRun({
        projectRoot: root,
        stateRoot,
        packagedRoot: skillsRoot,
        config,
        progress,
        writeOut: (text) => process.stdout.write(text),
        source: path.resolve(cwd, source),
        allowDirty,
      }),
    );
  warnLocalExecution(process.stderr);
  const release = await acquireProjectOperation(stateRoot);
  try {
    const sourcePath = path.resolve(cwd, source);
    const plan = await parseStrikerPlan(sourcePath);
    progress.begin({ backend: "local", plan: planPanelSeed(plan.tasks) });
    progress.preparing("Opening the local workspace.");
    const dispatcher = await createDispatcher(approvalMode);
    return await dispatcher.dispatch({
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
  } finally {
    progress.end();
    await release();
  }
}

async function recoverRun(
  action: "resume" | "retry" | "answer",
  answer?: string,
) {
  const root = await git.resolveRoot(cwd);
  const stateRoot = await git.resolvePrivatePath(root, "striker");
  const active = await new FileRunJournal(stateRoot).loadActive();
  const recovered = {
    history: new FileRunHistoryReader(new FileRunJournal(stateRoot)),
    location: active?.snapshot?.request.taskSource.location,
    parsePlan: parseStrikerPlan,
  };
  if (active?.snapshot?.request.execution?.backend === "docker")
    return progress.run(
      await recoveryProgressContext({ ...recovered, backend: "docker" }),
      () =>
        recoverDockerRun({
          projectRoot: root,
          stateRoot,
          action,
          progress,
          ...(answer === undefined ? {} : { answer }),
        }),
    );
  warnLocalExecution(process.stderr);
  const release = await acquireProjectOperation(stateRoot);
  try {
    progress.begin(
      await recoveryProgressContext({ ...recovered, backend: "local" }),
    );
    progress.preparing("Reopening the local workspace.");
    const dispatcher = await createDispatcher(await permissionConfig.read());
    return action === "answer"
      ? await dispatcher.answer(answer ?? "")
      : await dispatcher[action]();
  } finally {
    progress.end();
    await release();
  }
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

const exitCode = await runCli(process.argv.slice(2), {
  cleanupHandler: {
    cleanup: async (runId) => {
      const root = await git.resolveRoot(cwd);
      const stateRoot = await git.resolvePrivatePath(root, "striker");
      const release = await acquireProjectOperation(stateRoot);
      try {
        await new CleanupFeature(
          new FileRunJournal(stateRoot),
          new DockerFeatureResources(stateRoot, root),
        ).cleanup(runId);
      } finally {
        await release();
      }
    },
  },
  applyHandler: {
    apply: async (runId) => {
      const root = await git.resolveRoot(cwd);
      const stateRoot = await git.resolvePrivatePath(root, "striker");
      const release = await acquireProjectOperation(stateRoot);
      try {
        return await new ApplyFeature(
          new FileRunJournal(stateRoot),
          new ApplyResult(root),
        ).apply(runId);
      } finally {
        await release();
      }
    },
  },
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
  answerReader: {
    read: (file, context) =>
      progress.prompt(() =>
        createAnswerReader(cwd, terminal).read(file, context),
      ),
  },
  interaction: {
    get interactive() {
      return terminal.interactive;
    },
    setEnabled: (enabled) => {
      terminal.setEnabled(enabled);
    },
    choose: (context) =>
      progress.prompt(() => chooseRecoveryAction(terminal, context)),
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
      return commandResult(await recoverRun("answer", answer));
    },
    resume: async () => {
      return commandResult(await recoverRun("resume"));
    },
  },
  operationHandler: {
    discard: async () => {
      const root = await git.resolveRoot(cwd);
      const stateRoot = await git.resolvePrivatePath(root, "striker");
      const release = await acquireProjectOperation(stateRoot);
      try {
        await new RunOperations(
          new FileRunJournal(stateRoot),
          new DockerFeatureResources(stateRoot, root),
        ).discard();
      } finally {
        await release();
      }
    },
    retry: async () => {
      return commandResult(await recoverRun("retry"));
    },
    status: async () => {
      const root = await git.resolveRoot(cwd);
      return readExecutionStatus(await git.resolvePrivatePath(root, "striker"));
    },
  },
  skillInstaller: createPublicSkillInstaller(skillsRoot),
  stderr: process.stderr,
  stdout: process.stdout,
});
progress.close();
process.exitCode = exitCode;
