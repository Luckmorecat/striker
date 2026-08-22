import { describe, expect, it } from "vitest";

import { createProgram } from "./program.js";

describe("CLI program", () => {
  it("registers plan validation, status, and log commands", () => {
    const program = createProgram({
      cwd: "/repo",
      permissionConfig: {
        read: () => Promise.resolve("attended"),
        write: () => Promise.resolve(),
      },
      planQueryHandler: {
        log: () => Promise.resolve("# Plan log\n"),
        status: () => {
          throw new Error("Unexpected status query");
        },
      },
      planValidator: { validate: () => Promise.resolve({ taskCount: 0 }) },
      skillInstaller: {
        install: () => Promise.resolve({ changed: false }),
        supportedHarnesses: [],
      },
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    const plan = program.commands.find((command) => command.name() === "plan");
    expect(plan?.commands.map((command) => command.name())).toEqual([
      "validate",
      "status",
      "log",
    ]);
  });
});
