import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadProjectConfig,
  parseProjectConfig,
  projectConfigJsonSchema,
} from "./project-config.js";

describe("Striker project configuration", () => {
  it("defaults Codex and an empty installed-skill list", () => {
    expect(parseProjectConfig({ taskSource: "striker-plan" })).toEqual({
      harness: "codex",
      skills: [],
      taskSource: "striker-plan",
    });
  });

  it.each(["codex", "claude", "opencode", "pi"] as const)(
    "accepts the %s harness",
    (harness) => {
      expect(
        parseProjectConfig({ harness, taskSource: "striker-plan" }),
      ).toMatchObject({ harness });
    },
  );

  it("rejects an unsupported harness", () => {
    expect(() =>
      parseProjectConfig({ harness: "missing", taskSource: "striker-plan" }),
    ).toThrow();
  });

  it("rejects tracked configuration that tries to grant unattended access", () => {
    expect(() =>
      parseProjectConfig({
        approvalMode: "unattended",
        taskSource: "striker-plan",
      }),
    ).toThrow();
  });

  it("loads only the tracked project configuration file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-config-"));
    await writeFile(
      path.join(root, "striker.config.json"),
      JSON.stringify({ skills: ["security"], taskSource: "striker-plan" }),
    );

    await expect(loadProjectConfig(root)).resolves.toMatchObject({
      harness: "codex",
      skills: ["security"],
    });
  });

  it("keeps the packaged schema equal to the schema authority", async () => {
    const packaged = JSON.parse(
      await readFile(new URL("../../schema.json", import.meta.url), "utf8"),
    ) as unknown;

    expect(packaged).toEqual(projectConfigJsonSchema);
    expect(packaged).not.toHaveProperty("$id");
  });
});

it("accepts local image selection but never tracked image approval", () => {
  expect(
    parseProjectConfig({
      taskSource: "striker-plan",
      image: "my-striker:local",
    }),
  ).toMatchObject({ image: "my-striker:local" });
  expect(() =>
    parseProjectConfig({
      taskSource: "striker-plan",
      approvedImages: ["anything"],
    }),
  ).toThrow();
});
