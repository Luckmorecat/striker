import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parsePlanManifest, planManifestJsonSchema } from "../../index.js";

describe("parsePlanManifest", () => {
  it("accepts a versioned Striker plan with ordered task paths", () => {
    expect(
      parsePlanManifest({
        $schema: "./node_modules/@kisshot/striker/plan.schema.json",
        taskSource: "striker-plan",
        tasks: ["01-bootstrap.md", "nested/02-finish.md"],
        version: 1,
      }),
    ).toEqual({
      $schema: "./node_modules/@kisshot/striker/plan.schema.json",
      taskSource: "striker-plan",
      tasks: ["01-bootstrap.md", "nested/02-finish.md"],
      version: 1,
    });
  });

  it.each([
    [
      "an empty task list",
      { taskSource: "striker-plan", tasks: [], version: 1 },
    ],
    [
      "an unsupported version",
      { taskSource: "striker-plan", tasks: ["01.md"], version: 2 },
    ],
    [
      "an unsupported source",
      { taskSource: "markdown", tasks: ["01.md"], version: 1 },
    ],
    [
      "an absolute task path",
      { taskSource: "striker-plan", tasks: ["/tmp/01.md"], version: 1 },
    ],
    [
      "a traversing task path",
      { taskSource: "striker-plan", tasks: ["tasks/../01.md"], version: 1 },
    ],
    [
      "duplicate task paths",
      { taskSource: "striker-plan", tasks: ["01.md", "01.md"], version: 1 },
    ],
    [
      "a non-Markdown task path",
      { taskSource: "striker-plan", tasks: ["01.txt"], version: 1 },
    ],
    [
      "a reserved support path",
      { taskSource: "striker-plan", tasks: ["spine.md"], version: 1 },
    ],
  ])("rejects %s", (_description, manifest) => {
    expect(() => parsePlanManifest(manifest)).toThrow();
  });

  it("keeps the packaged JSON Schema derived from the Zod schema", async () => {
    const packaged = JSON.parse(
      await readFile(
        new URL("../../../plan.schema.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(packaged).toEqual(planManifestJsonSchema);
  });
});
