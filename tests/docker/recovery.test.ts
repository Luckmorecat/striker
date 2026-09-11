import { readFile, writeFile, rm, rename } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { fakeResponses } from "./fake-responses.js";
import {
  recoveryFixture,
  fakeBroker,
  hostCommand,
  activeFixture,
  assertRepeatedReviews,
} from "./recovery-fixture.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";
import { recoverDockerRun } from "../../src/cli/docker-recovery.js";

for (const harness of ["codex", "pi"] as const) {
  test(`${harness} survives killed hosts at initial delivery, both reviews and between tasks with frozen identity`, async () => {
    const fixture = await recoveryFixture(harness);
    const fake = await fakeResponses();
    let id: string | undefined;
    try {
      await fakeBroker(fixture, fake.url);
      expect(
        (await hostCommand(fixture, "run", "task_session_started")).event?.type,
      ).toBe("task_session_started");
      const active = await activeFixture(fixture);
      id = active.id;
      await changeDefaultsAndInstallTool(fixture, active);
      const standards = await hostCommand(
        fixture,
        "resume",
        "standards_review_started",
      );
      expect(standards.event?.type).toBe("standards_review_started");
      const plan = await hostCommand(
        fixture,
        "resume",
        "plan_compliance_review_started",
      );
      expect(plan.event?.type).toBe("plan_compliance_review_started");
      expect(
        (await hostCommand(fixture, "resume", "task_completed")).event?.type,
      ).toBe("task_completed");
      expect(
        await readFile(
          path.join(active.environmentRoot, "checkout/retained-tool"),
          "utf8",
        ),
      ).toBe("installed");
      await writeFile(
        path.join(fixture.plan, "tasks/02.md"),
        (await readFile(path.join(fixture.plan, "tasks/02.md"), "utf8")) +
          "\nAccepted future-task clarification: keep exact content.\n",
      );
      await rename(
        path.join(fixture.plan, "tasks/02.md"),
        path.join(fixture.plan, "tasks/03.md"),
      );
      const manifestFile = path.join(fixture.plan, "plan.json");
      await writeFile(
        manifestFile,
        (await readFile(manifestFile, "utf8")).replace(
          "tasks/02.md",
          "tasks/03.md",
        ),
      );
      expect((await hostCommand(fixture, "resume")).result).toMatchObject({
        status: "completed",
      });
      await assertRepeatedReviews(fixture, active.active.planId, [
        standards.event,
        plan.event,
      ]);
      expect(fake.errors).toEqual([]);
      await expect(
        recoverDockerRun({ ...fixture.run, action: "resume" }),
      ).rejects.toThrow("No Docker run is active");
    } finally {
      if (id) await dockerCommand(["rm", "--force", id]);
      await fake.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 900_000);
}
async function changeDefaultsAndInstallTool(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  active: Awaited<ReturnType<typeof activeFixture>>,
) {
  await writeFile(
    path.join(fixture.source, "striker.config.json"),
    '{"harness":"invalid","model":"unavailable"}',
  );
  await writeFile(
    path.join(fixture.stateRoot, "execution.json"),
    JSON.stringify({ resources: { cpus: 1, memoryMiB: 512, pids: 32 } }),
  );
  await writeFile(
    path.join(active.environmentRoot, "checkout/retained-tool"),
    "installed",
  );
  await dockerCommand(["start", active.id]);
  await dockerCommand([
    "exec",
    active.id,
    "sh",
    "-c",
    "printf retained-tool >> .git/info/exclude",
  ]);
}
