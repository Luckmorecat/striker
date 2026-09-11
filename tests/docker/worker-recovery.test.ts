import { readFile, writeFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { fakeResponses } from "./fake-responses.js";
import {
  recoveryFixture,
  fakeBroker,
  hostCommand,
  activeFixture,
} from "./recovery-fixture.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";

test("a killed verification worker pauses the host and resumes the same implementation thread", async () => {
  const fixture = await recoveryFixture("pi");
  const fake = await fakeResponses();
  let id: string | undefined;
  try {
    await fakeBroker(fixture, fake.url);
    const task = path.join(fixture.plan, "tasks/01.md");
    await writeFile(
      task,
      (await readFile(task, "utf8")).replace(
        'test "$(cat first.txt)" = first',
        'test "$(cat first.txt)" = first\nprintf entered > /state/verification-entered\nwhile test ! -f /state/verification-release; do sleep 0.1; done',
      ),
    );
    const running = hostCommand(fixture, "run");
    // Observe the public journal and a deliberate verification-command barrier.
    const active = await waitForVerification(fixture);
    id = active.id;
    const session = active.snapshot.session;
    await dockerCommand(["kill", id]);
    expect((await running).result).toMatchObject({ status: "needs_attention" });
    await writeFile(
      path.join(active.environmentRoot, "state/verification-release"),
      "continue",
    );
    expect((await hostCommand(fixture, "resume")).result).toMatchObject({
      status: "completed",
    });
    const events = await readFile(
      path.join(
        fixture.stateRoot,
        "plans",
        active.active.planId,
        "events.ndjson",
      ),
      "utf8",
    );
    const starts = events
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: { type: string; session?: { id: string } };
          },
      )
      .filter(
        ({ event }) =>
          event.type === "task_session_started" &&
          event.session?.id === session?.id,
      );
    expect(starts).toHaveLength(1);
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await fake.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 600_000);
async function waitForVerification(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
) {
  for (let attempt = 0; attempt < 2400; attempt++) {
    const active = await activeFixture(fixture).catch(() => undefined);
    if (
      active &&
      (await readFile(
        path.join(active.environmentRoot, "state/verification-entered"),
        "utf8",
      ).catch(() => ""))
    )
      return active;
    await delay(50);
  }
  throw new Error("Verification barrier was not reached");
}

test("an implementation worker killed after its tool call resumes the same recorded session", async () => {
  const fixture = await recoveryFixture("pi");
  let id: string | undefined;
  let interrupted = false;
  let preserved: string | undefined;
  const fake = await fakeResponses(async (input) => {
    if (interrupted || !input.includes("function_call_output")) return;
    interrupted = true;
    const active = await activeFixture(fixture);
    id = active.id;
    preserved = active.snapshot.session?.id;
    await dockerCommand(["kill", active.id]);
  });
  try {
    await fakeBroker(fixture, fake.url);
    await expect(hostCommand(fixture, "run")).rejects.toThrow(
      /worker.*killed|worker.*exited/i,
    );
    const active = await activeFixture(fixture);
    expect(active.snapshot.session?.id).toBe(preserved);
    expect(
      await readFile(
        path.join(active.environmentRoot, "checkout/first.txt"),
        "utf8",
      ),
    ).toBe("first");
    expect((await hostCommand(fixture, "resume")).result).toMatchObject({
      status: "completed",
    });
    const events = await readFile(
      path.join(
        fixture.stateRoot,
        "plans",
        active.active.planId,
        "events.ndjson",
      ),
      "utf8",
    );
    expect(
      events
        .trim()
        .split("\n")
        .filter(
          (line) =>
            line.includes('"type":"task_session_started"') &&
            line.includes(preserved ?? "missing"),
        ),
    ).toHaveLength(1);
  } finally {
    if (id) await dockerCommand(["rm", "--force", id]);
    await fake.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 600_000);
