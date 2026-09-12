import type { RunActivity } from "../../src/core/run-observation.js";
import { activityTextLimit } from "../../src/runner/visible-activity.js";
import { dockerExecutionServices } from "../../src/infrastructure/docker/execution-services.js";
import { StageExecutor } from "../../src/infrastructure/docker/stage-executor.js";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { featureFixture, dispatchFixture } from "./feature-fixture.js";
import { fakeResponses } from "./fake-responses.js";
import { RunGateway } from "../../src/infrastructure/gateway/run-gateway.js";
import { DockerEnvironment } from "../../src/infrastructure/docker/docker-environment.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { resolveContextResources } from "../../src/infrastructure/docker/context-resources.js";
import { prepareWorkerResources } from "../../src/infrastructure/docker/worker-resources.js";
import {
  exportSourceCheckout,
  initializeCheckout,
} from "../../src/infrastructure/docker/independent-checkout.js";

const selection = { model: "gpt-5.6-sol", effort: "low" } as const;

for (const harness of ["codex", "pi"] as const)
  test(`${harness} certifies two tasks through the retained worker with fake model responses`, async () => {
    const fixture = await featureFixture();
    const fake = await fakeResponses();
    const gateway = new RunGateway({
      brokerUrl: fake.url,
      brokerKey: "host-only-fake-key",
      model: "gpt-5.6-sol",
      effort: "low",
    });
    let id: string | undefined;
    try {
      const access = await gateway.listen(
        path.join(fixture.root, "gateway.sock"),
      );
      const environment = await new DockerEnvironment().allocate({
        stateRoot: fixture.root,
        runId: `feature-${harness}`,
        image: await prepareImage(),
        resources: { cpus: 2, memoryMiB: 2048, pids: 128 },
        gateway: {
          socketPath: path.join(fixture.root, "gateway.sock"),
          selection,
        },
      });
      id = environment.environmentId;
      const context = await resolveContextResources({
        projectRoot: fixture.source,
        packagedRoot: fixture.packagedRoot,
        skills: [],
      });
      await exportSourceCheckout(fixture.source, environment.inputs);
      await prepareWorkerResources(environment.inputs, context);
      await dockerCommand(["start", id]);
      await initializeCheckout(environment);
      const activity: RunActivity[] = [];
      const { result, recovery, events } = await dispatchFixture(fixture, {
        environment,
        harness,
        contextId: context.identity,
        observer: {
          observe: (observation) => {
            if (observation.kind === "activity") activity.push(observation);
          },
        },
        selection,
        token: access.token,
      });
      expect(fake.errors).toEqual([]);
      expect(result).toMatchObject({ status: "completed" });
      assertVisibleActivity(activity);
      expect(recovery?.completedTasks).toHaveLength(2);
      const session = assertStageSessions(events);
      const resumed = await dockerExecutionServices(
        new StageExecutor({
          environment,
          harness,
          contextId: context.identity,
          selection,
          token: access.token,
        }),
        fixture.source,
        [],
      ).runner.resumeSession(
        session,
        "Repeat the previous implementation result without changing files.",
      );
      expect(resumed).toMatchObject({ status: "returned", session });
      await assertSourceUnchanged(fixture);
    } finally {
      try {
        if (id) await dockerCommand(["rm", "--force", id]);
      } finally {
        await gateway.close();
        await fake.close();
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  }, 600_000);

/** The worker's activity frames must reach the host bounded and printable. */
function assertVisibleActivity(activity: readonly RunActivity[]) {
  expect(activity.length).toBeGreaterThan(0);
  expect(activity.map((entry) => entry.activity)).toContain("tool");
  for (const entry of activity) {
    expect(entry.text.length).toBeLessThanOrEqual(activityTextLimit);
    expect(entry.text).not.toMatch(/[\p{Cc}]/u);
  }
}

async function assertSourceUnchanged(
  fixture: Awaited<ReturnType<typeof featureFixture>>,
) {
  expect((await fixture.git("status", "--porcelain")).stdout).toBe("");
  expect(
    (await fixture.git("log", "--oneline")).stdout.trim().split("\n"),
  ).toHaveLength(1);
}

function assertStageSessions(
  events: Awaited<ReturnType<typeof dispatchFixture>>["events"],
) {
  const session = events.findLast(
    (event) => event.type === "task_session_started",
  )?.session;
  if (!session) throw new Error("Missing durable implementation session");
  expect(
    new Set([
      session.id,
      events.findLast((event) => event.type === "standards_review_started")
        ?.session.id,
      events.findLast(
        (event) => event.type === "plan_compliance_review_started",
      )?.session.id,
    ]).size,
  ).toBe(3);
  return session;
}
