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

for (const kind of ["standards", "plan_compliance"] as const) {
  test(`${kind} repair survives a killed host in the same isolated repair thread`, async () => {
    const fixture = await recoveryFixture("pi");
    const fake = await fakeResponses(undefined, kind);
    let id: string | undefined;
    try {
      await fakeBroker(fixture, fake.url);
      const boundary = await hostCommand(
        fixture,
        "run",
        `${kind}_repair_started`,
      );
      expect(boundary.event?.type).toBe(`${kind}_repair_started`);
      const active = await activeFixture(fixture);
      id = active.id;
      await writeFile(
        path.join(active.environmentRoot, "state/installed-tool"),
        "retained",
      );
      const result = await hostCommand(fixture, "resume");
      if (result.result?.status !== "completed")
        console.info((await active.journal.loadActive())?.snapshot?.attention);
      expect(result.result).toMatchObject({
        status: "completed",
      });
      await assertRepeatedReviews(fixture, active.active.planId, [
        boundary.event,
      ]);
      expect(
        await readFile(
          path.join(active.environmentRoot, "state/installed-tool"),
          "utf8",
        ),
      ).toBe("retained");
    } finally {
      if (id) await dockerCommand(["rm", "--force", id]);
      await fake.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 600_000);
}

test("explicit retry creates a fresh stage after session loss and retains installed tools", async () => {
  const fixture = await recoveryFixture("pi");
  const fake = await fakeResponses();
  let id: string | undefined;
  try {
    await fakeBroker(fixture, fake.url);
    const initial = await hostCommand(fixture, "run", "task_session_started");
    if (
      initial.event?.type !== "task_session_started" ||
      !initial.event.session.execution
    )
      throw new Error("Missing initial stage");
    const active = await activeFixture(fixture);
    id = active.id;
    const home = path.join(
      active.environmentRoot,
      "state/stages",
      initial.event.session.execution.stageId,
    );
    await rename(home, `${home}-lost`);
    await writeFile(
      path.join(active.environmentRoot, "state/installed-tool"),
      "retained",
    );
    expect((await hostCommand(fixture, "resume")).result).toMatchObject({
      status: "needs_attention",
    });
    const fresh = await hostCommand(fixture, "retry", "task_session_started");
    if (fresh.event?.type !== "task_session_started")
      throw new Error("Fresh stage not recorded");
    expect(fresh.event.session.id).not.toBe(initial.event.session.id);
    expect(fresh.event.session.execution?.stageId).not.toBe(
      initial.event.session.execution.stageId,
    );
    expect((await hostCommand(fixture, "resume")).result).toMatchObject({
      status: "completed",
    });
    expect(
      await readFile(
        path.join(active.environmentRoot, "state/installed-tool"),
        "utf8",
      ),
    ).toBe("retained");
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await fake.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 600_000);
