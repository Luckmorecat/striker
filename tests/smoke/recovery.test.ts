import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import {
  recoveryFixture,
  hostCommand,
  activeFixture,
  assertRepeatedReviews,
} from "../docker/recovery-fixture.js";
import { readBroker } from "../../src/infrastructure/gateway/broker-storage.js";
import { CredentialBroker } from "../../src/infrastructure/gateway/credential-broker.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";

test("authenticated recovery retains stage identity across killed hosts and changed defaults", async () => {
  const harness = process.env.STRIKER_SMOKE_HARNESS;
  const brokerRoot = process.env.STRIKER_SMOKE_BROKER_ROOT;
  if (!brokerRoot || (harness !== "codex" && harness !== "pi"))
    throw new Error("Explicit harness and prepared subscription required");
  const fixture = await recoveryFixture(harness);
  let id: string | undefined;
  try {
    const broker = await readBroker(brokerRoot);
    await new CredentialBroker(path.join(fixture.stateRoot, "broker")).prepare(
      broker.binary,
      broker.authDirectory,
    );
    expect(
      (await hostCommand(fixture, "run", "task_session_started")).event?.type,
    ).toBe("task_session_started");
    const active = await activeFixture(fixture);
    id = active.id;
    await writeFile(
      path.join(fixture.source, "striker.config.json"),
      '{"harness":"claude","model":"unavailable"}',
    );
    const review = await hostCommand(
      fixture,
      "resume",
      "standards_review_started",
    );
    expect(review.event?.type).toBe("standards_review_started");
    const plan = await hostCommand(
      fixture,
      "resume",
      "plan_compliance_review_started",
    );
    expect(plan.event?.type).toBe("plan_compliance_review_started");
    expect((await hostCommand(fixture, "resume")).result).toMatchObject({
      status: "completed",
    });
    expect(
      (await active.journal.load(active.active.planId))?.completedTasks,
    ).toHaveLength(2);
    await assertRepeatedReviews(fixture, active.active.planId, [
      review.event,
      plan.event,
    ]);
    expect(
      (await fixture.git("log", "--oneline")).stdout.trim().split("\n"),
    ).toHaveLength(1);
    console.info(
      `${harness}: real subscription, killed hosts, resumed reviewer identities, retained image/model, two completed tasks`,
    );
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 1_200_000);
