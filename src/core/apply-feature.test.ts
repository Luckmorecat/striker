import { expect, it } from "vitest";
import type { RunSnapshot } from "./contracts.js";
import { applicationIntent, replayApplication } from "./apply-feature.js";

function completed(): RunSnapshot {
  return {
    runId: "apply-test",
    planId: "plan",
    status: "completed",
    task: null,
    session: null,
    request: {
      runId: "apply-test",
      planId: "plan",
      completedTasks: [],
      skills: [],
      taskSource: { type: "memory", location: "plan" },
      execution: {
        backend: "docker",
        recoveryId: "c".repeat(64),
        environmentId: "d".repeat(64),
        imageId: `sha256:${"e".repeat(64)}`,
        sourceRoot: "/repo",
        sourceHead: "a".repeat(40),
        sourceBranch: "main",
      },
    },
    resultExport: {
      branch: "codex/striker-apply-test",
      head: "b".repeat(40),
      pending: null,
      error: null,
    },
  };
}
it("only completed fully exported features produce application intent", () => {
  const snapshot = completed();
  expect(applicationIntent(snapshot)).toMatchObject({
    sourceRoot: "/repo",
    sourceBranch: "main",
    head: "b".repeat(40),
  });
  for (const status of [
    "running",
    "needs_attention",
    "failed",
    "discarded",
  ] as const)
    expect(() => applicationIntent({ ...snapshot, status })).toThrow(
      /completed/,
    );
  expect(() =>
    applicationIntent({
      ...snapshot,
      resultExport: undefined,
    } as unknown as RunSnapshot),
  ).toThrow(/export/);
});
it("application completion requires a matching durable intent", () => {
  const snapshot = completed();
  const event = {
    type: "application_completed",
    runId: snapshot.runId,
    head: "b".repeat(40),
  } as const;
  expect(() => replayApplication(snapshot, event)).toThrow(/intent/);
  const started = replayApplication(snapshot, {
    ...event,
    type: "application_started",
  });
  expect(replayApplication(started, event).application).toEqual({
    head: event.head,
    status: "completed",
  });
  expect(() =>
    replayApplication(started, { ...event, head: "f".repeat(40) }),
  ).toThrow(/certified/);
});
