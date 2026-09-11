import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import {
  activeFixture,
  recoveryFixture,
  fakeBroker,
  hostCommand,
} from "./recovery-fixture.js";
import { fakeResponses } from "./fake-responses.js";
import { recoverDockerRun } from "../../src/cli/docker-recovery.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";

test("missing or changed resources stop recovery without replacing the environment or reviewer", async () => {
  const fixture = await recoveryFixture("pi");
  const fake = await fakeResponses();
  let id: string | undefined;
  try {
    await fakeBroker(fixture, fake.url);
    const boundary = await hostCommand(
      fixture,
      "run",
      "standards_review_started",
    );
    if (boundary.event?.type !== "standards_review_started")
      throw new Error("Reviewer boundary not reached");
    const {
      journal,
      id: environmentId,
      environmentRoot: root,
    } = await activeFixture(fixture);
    id = environmentId;
    const resume = () => recoverDockerRun({ ...fixture.run, action: "resume" });
    await rename(path.join(root, "state"), path.join(root, "state-held"));
    await expect(resume()).rejects.toThrow(
      /Retained execution resource is missing:.*state.*Restore/,
    );
    await rename(path.join(root, "state-held"), path.join(root, "state"));
    const context = path.join(root, "inputs/context.json");
    const contents = await readFile(context);
    await writeFile(context, "changed");
    await expect(resume()).rejects.toThrow(
      "Frozen execution files missing or changed",
    );
    await writeFile(context, contents);
    const stage = boundary.event.session.execution;
    if (!stage) throw new Error("Missing reviewer stage identity");
    const snapshot = path.join(
      root,
      "inputs/reviews",
      stage.stageId,
      "first.txt",
    );
    await writeFile(snapshot, "changed while paused");
    expect(await resume()).toMatchObject({
      status: "needs_attention",
      reason: "standards_review_interrupted",
    });
    expect((await journal.loadActive())?.snapshot?.attention?.detail).toContain(
      "snapshot",
    );
    expect(
      (await journal.loadActive())?.snapshot?.standardsReview?.reviewSession,
    ).toEqual(boundary.event.session);
    await dockerCommand(["rm", "--force", id]);
    await expect(resume()).rejects.toThrow(/No such|missing/);
    id = undefined;
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await fake.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 600_000);
