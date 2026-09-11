import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { featureFixture } from "../docker/feature-fixture.js";
import { dispatchDockerRun } from "../../src/cli/docker-run.js";
import { parseProjectConfig } from "../../src/config/project-config.js";
import { prepareImage } from "../../src/infrastructure/docker/prepare-image.js";
import { CredentialBroker } from "../../src/infrastructure/gateway/credential-broker.js";
import { readBroker } from "../../src/infrastructure/gateway/broker-storage.js";
import { FileRunJournal } from "../../src/infrastructure/file-run-journal.js";
import { parseStrikerPlan } from "../../src/adapters/striker-plan/plan-parser.js";
import { dockerCommand } from "../../src/infrastructure/docker/docker-command.js";

test("real subscription implements and independently reviews two tasks in one retained environment", async () => {
  const harness = process.env.STRIKER_SMOKE_HARNESS;
  const brokerRoot = process.env.STRIKER_SMOKE_BROKER_ROOT;
  if (!brokerRoot || (harness !== "codex" && harness !== "pi"))
    throw new Error("Explicit harness and prepared broker login are required");
  const fixture = await featureFixture();
  const stateRoot = path.join(fixture.root, "state");
  let id: string | undefined;
  try {
    await mkdir(stateRoot, { mode: 0o700 });
    const image = await prepareImage();
    await writeFile(
      path.join(stateRoot, "prepared-image.json"),
      JSON.stringify(image),
    );
    const descriptor = await readBroker(brokerRoot);
    await new CredentialBroker(path.join(stateRoot, "broker")).prepare(
      descriptor.binary,
      descriptor.authDirectory,
    );
    const result = await dispatchDockerRun({
      projectRoot: fixture.source,
      stateRoot,
      packagedRoot: fixture.packagedRoot,
      config: parseProjectConfig({ taskSource: "striker-plan", harness }),
      source: fixture.plan,
      allowDirty: false,
    });
    const recovery = await new FileRunJournal(stateRoot).load(
      (await parseStrikerPlan(fixture.plan)).identity,
    );
    id = recovery?.snapshot?.request.execution?.environmentId;
    expect(result).toMatchObject({ status: "completed" });
    expect(recovery?.completedTasks).toHaveLength(2);
    expect(recovery?.snapshot?.status).toBe("completed");
    expect((await fixture.git("status", "--porcelain")).stdout).toBe("");
    expect(
      (await fixture.git("log", "--oneline")).stdout.trim().split("\n"),
    ).toHaveLength(1);
    const checkout = path.join(
      stateRoot,
      "environments",
      result.runId,
      "checkout",
    );
    expect(await readFile(path.join(checkout, "first.txt"), "utf8")).toBe(
      "first",
    );
    expect(await readFile(path.join(checkout, "second.txt"), "utf8")).toBe(
      "second",
    );
    console.info(
      `${harness}: two tasks, independent reviews, retained container, unchanged host source; ${image.imageId}`,
    );
  } finally {
    try {
      if (id) await dockerCommand(["rm", "--force", id]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}, 1_200_000);
