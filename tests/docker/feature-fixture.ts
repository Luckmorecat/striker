import type { RunJournalEvent } from "../../src/core/contracts.js";
import { eventEnvelopeSchema } from "../../src/infrastructure/run-journal-schema.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StrikerPlanAdapter } from "../../src/adapters/striker-plan/striker-plan-adapter.js";
import { AdapterRegistry } from "../../src/core/adapter-registry.js";
import { Dispatcher } from "../../src/core/dispatcher.js";
import { FileRunJournal } from "../../src/infrastructure/file-run-journal.js";
import { dockerExecutionServices } from "../../src/infrastructure/docker/execution-services.js";
import {
  StageExecutor,
  type StageExecutorOptions,
} from "../../src/infrastructure/docker/stage-executor.js";
import { parseStrikerPlan } from "../../src/adapters/striker-plan/plan-parser.js";

export async function featureFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "striker-feature-"));
  const source = path.join(root, "source");
  const plan = path.join(root, "plan");
  await mkdir(source);
  await mkdir(path.join(plan, "tasks"), { recursive: true });
  await writeFile(
    path.join(source, "AGENTS.md"),
    "Keep each task to one commit. Follow its exact output.\n",
  );
  const git = (...args: string[]) =>
    promisify(execFile)("git", ["-C", source, ...args]);
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@localhost");
  await git("add", ".");
  await git("commit", "-m", "baseline");
  await writeFile(
    path.join(plan, "plan.json"),
    JSON.stringify({
      version: 3,
      taskSource: "striker-plan",
      tasks: ["tasks/01.md", "tasks/02.md"],
      assumptions: {},
      defaults: {},
      outcomeRoutes: [],
    }),
  );
  await writeFile(
    path.join(plan, "spine.md"),
    "# Goal\nCreate first.txt and second.txt with their specified content. No other changes.\n",
  );
  await writeFile(
    path.join(plan, "map.md"),
    "# Map\nfirst.txt then second.txt.\n",
  );
  for (const [number, word] of [
    ["01", "first"],
    ["02", "second"],
  ] as const) {
    const task = `# ${word}\n\n## Build\n\nSLICE_TEST_TASK_${number === "01" ? "1" : "2"}. Create ${word}.txt containing exactly ${word}, without a newline. ${number === "02" ? "First confirm first.txt contains first." : ""} Commit this task once.\n\n## Paths\n\n- Create ${word}.txt\n\n## Test contract\n\n- Verify exact file content using the shell.\n\n## Verify\n\n\`\`\`sh\ntest "$(cat ${word}.txt)" = ${word}\n\`\`\`\n`;
    await writeFile(path.join(plan, `tasks/${number}.md`), task);
  }
  return {
    root,
    source,
    plan,
    git,
    packagedRoot: fileURLToPath(new URL("../../skills", import.meta.url)),
  };
}
export async function dispatchFixture(
  fixture: Awaited<ReturnType<typeof featureFixture>>,
  options: StageExecutorOptions,
) {
  const adapters = new AdapterRegistry();
  adapters.register(
    new StrikerPlanAdapter({
      projectRoot: fixture.source,
      workflowRoot: path.join(fixture.packagedRoot, "striker-implementor"),
      inlineContext: true,
    }),
  );
  const journal = new FileRunJournal(path.join(fixture.root, "journal"));
  const dispatcher = new Dispatcher({
    adapters,
    journal,
    ...dockerExecutionServices(new StageExecutor(options), fixture.source, []),
  });
  const planId = (await parseStrikerPlan(fixture.plan)).identity;
  const result = await dispatcher.dispatch({
    planId,
    runId: "feature",
    skills: [],
    completedTasks: [],
    taskSource: { type: "striker-plan", location: fixture.plan },
  });
  const contents = await readFile(
    path.join(fixture.root, "journal", "plans", planId, "events.ndjson"),
    "utf8",
  );
  const events = contents
    .trim()
    .split("\n")
    .map(
      (line) =>
        eventEnvelopeSchema.parse(JSON.parse(line)).event as RunJournalEvent,
    );
  return { result, recovery: await journal.load(planId), events };
}
