import { describe, expect, it } from "vitest";

import type { RunActivity } from "../../core/run-observation.js";
import { consumeFrames, workerResponses } from "./worker-client.js";

const id = "cdd9e33b-5b67-48de-b0d6-f6cb3f6fef76";
const session = { id: "session-1" };

function frame(value: Record<string, unknown>): string {
  return JSON.stringify({ id, ...value });
}

function reader(options?: {
  readonly activity?: (activity: RunActivity) => void;
  readonly acknowledged?: string[];
  readonly started?: (value: unknown) => Promise<void>;
}) {
  return workerResponses({
    acknowledge: () => options?.acknowledged?.push(id),
    id,
    operation: "implement",
    ...(options?.activity === undefined ? {} : { activity: options.activity }),
    ...(options?.started === undefined ? {} : { started: options.started }),
  });
}

const returned = {
  type: "result",
  value: { output: "done", session, status: "returned" },
};

describe("worker response frames", () => {
  it("reports correlated activity while still carrying the result", async () => {
    const seen: RunActivity[] = [];
    const responses = reader({ activity: (value) => seen.push(value) });

    await responses.accept(
      frame({ activity: "tool", text: "Read diff", type: "activity" }),
    );
    await responses.accept(
      frame({ activity: "note", text: "Editing", type: "activity" }),
    );
    await responses.accept(frame(returned));

    expect(seen).toEqual([
      { activity: "tool", text: "Read diff" },
      { activity: "note", text: "Editing" },
    ]);
    expect(responses.completed).toBe(true);
    expect(responses.value).toEqual(returned.value);
  });

  it("ignores activity that arrives after the result", async () => {
    const seen: RunActivity[] = [];
    const responses = reader({ activity: (value) => seen.push(value) });

    await responses.accept(frame(returned));
    await responses.accept(
      frame({ activity: "note", text: "late", type: "activity" }),
    );

    expect(seen).toEqual([]);
    expect(responses.value).toEqual(returned.value);
  });

  it("still refuses a second result after completion", async () => {
    const responses = reader();

    await responses.accept(frame(returned));

    await expect(responses.accept(frame(returned))).rejects.toThrow(
      "Worker sent output after completion",
    );
  });

  it("drops activity when no display is listening", async () => {
    const responses = reader();

    // The frame is valid, so only the absent sink can swallow it.
    await responses.accept(
      frame({ activity: "note", text: "Editing", type: "activity" }),
    );
    await responses.accept(frame(returned));

    expect(responses.value).toEqual(returned.value);
  });

  it("never fails the operation because a display threw", async () => {
    const responses = reader({
      activity: () => {
        throw new Error("display failed");
      },
    });

    await responses.accept(
      frame({ activity: "note", text: "Editing", type: "activity" }),
    );
    await responses.accept(frame(returned));

    expect(responses.value).toEqual(returned.value);
  });
});

describe("worker frame correlation", () => {
  it("acknowledges a durable session start exactly once", async () => {
    const acknowledged: string[] = [];
    const responses = reader({
      acknowledged,
      started: () => Promise.resolve(),
    });

    await responses.accept(frame({ session, type: "started" }));

    expect(acknowledged).toEqual([id]);
    await expect(
      responses.accept(frame({ session, type: "started" })),
    ).rejects.toThrow("Unexpected worker session announcement");
  });

  it("refuses a frame that is not correlated with the request", async () => {
    const responses = reader();

    await expect(
      responses.accept(
        JSON.stringify({
          activity: "note",
          id: "other",
          text: "x",
          type: "activity",
        }),
      ),
    ).rejects.toThrow();
  });

  it("raises the worker's reported error", async () => {
    const responses = reader();

    await expect(
      responses.accept(
        frame({ message: "Isolated worker failed", type: "error" }),
      ),
    ).rejects.toThrow("Isolated worker failed");
  });
});

describe("worker stdout reassembly", () => {
  async function* chunks(...values: readonly string[]) {
    await Promise.resolve();
    yield* values;
  }

  it("rebuilds one activity frame split across stdout chunks", async () => {
    const seen: RunActivity[] = [];
    const responses = reader({ activity: (value) => seen.push(value) });
    const activity = frame({
      activity: "tool",
      text: "Edit answer-command.ts",
      type: "activity",
    });

    const trailing = await consumeFrames(
      chunks(
        activity.slice(0, 20),
        `${activity.slice(20)}\n${frame(returned)}\n`,
      ),
      (line) => responses.accept(line),
    );

    expect(seen).toEqual([
      { activity: "tool", text: "Edit answer-command.ts" },
    ]);
    expect(trailing).toBe("");
    expect(responses.value).toEqual(returned.value);
  });

  it("returns an unterminated trailing frame instead of accepting it", async () => {
    const responses = reader();

    const trailing = await consumeFrames(
      chunks(`${frame(returned)}\n{"id":"`),
      (line) => responses.accept(line),
    );

    expect(trailing).toBe('{"id":"');
  });
});
