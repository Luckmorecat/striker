import { describe, expect, it } from "vitest";

import { commandResult } from "./command-result.js";

const task = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build the command.",
  title: "Build the command",
};

describe("CLI command result", () => {
  it.each(["run_initialization_interrupted", "session_resume_failed"] as const)(
    "gives retry-only guidance for %s",
    (reason) => {
      expect(
        commandResult({
          reason,
          runId: "run-1",
          session: null,
          status: "needs_attention",
          task,
        }),
      ).toEqual({
        message: `Run needs attention: ${reason}. Run \`striker retry\` to start a fresh attempt.`,
        status: "needs_attention",
      });
    },
  );

  it("keeps completed-source conflict guidance unchanged", () => {
    expect(
      commandResult({
        completedTask: task.identity,
        currentTask: null,
        reason: "completed_task_changed",
        runId: "run-1",
        session: null,
        status: "needs_attention",
        task: null,
      }),
    ).toEqual({
      message:
        "Run needs attention: completed_task_changed. Run `striker answer`, `striker resume`, or `striker retry`.",
      status: "needs_attention",
    });
  });
});
