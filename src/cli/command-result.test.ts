import { describe, expect, it } from "vitest";
import { commandResult } from "./command-result.js";
const task = {
  identity: { id: "tasks/01.md", revision: "revision-1" },
  instructions: "Build the command.",
  title: "Build the command",
};
describe("CLI command result", () => {
  it.each([
    "run_initialization_interrupted",
    "session_resume_failed",
    "task_outcome_limit_exceeded",
  ] as const)(
    "preserves typed attention %s without guessing availability",
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
        message: `Run needs attention: ${reason}.`,
        status: "needs_attention",
        reason,
      });
    },
  );
  it("preserves completed-source conflicts for durable inspection", () => {
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
      message: "Run needs attention: completed_task_changed.",
      status: "needs_attention",
      reason: "completed_task_changed",
    });
  });
});
it("prints the host result branch on completion", () => {
  expect(
    commandResult({
      status: "source_exhausted",
      runId: "export",
      resultExport: {
        branch: "codex/striker-export",
        head: "a".repeat(40),
        pending: null,
        error: null,
      },
    }).message,
  ).toContain("Result branch: codex/striker-export");
});
