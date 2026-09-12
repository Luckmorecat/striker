import { expect, test } from "vitest";
import {
  activityTextLimit,
  visibleActivityStream,
} from "../visible-activity.js";
import { parseWorkerRequest, parseWorkerResponse } from "./protocol.js";

const id = "cdd9e33b-5b67-48de-b0d6-f6cb3f6fef76";
test("worker protocol accepts only bounded typed operations for the recorded request", () => {
  expect(
    parseWorkerRequest(JSON.stringify({ id, operation: "inspect" })),
  ).toEqual({ id, operation: "inspect" });
  for (const value of [
    { id, operation: "hostExec", command: "touch /host" },
    { id, operation: "inspect", cwd: "/host" },
  ]) {
    expect(() => parseWorkerRequest(JSON.stringify(value))).toThrow();
  }
  expect(() => parseWorkerRequest("x".repeat(16 * 1024 * 1024 + 1))).toThrow();
  expect(() =>
    parseWorkerResponse(
      JSON.stringify({ id: "wrong", type: "result", value: true }),
      id,
      "isAncestor",
    ),
  ).toThrow();
  expect(() =>
    parseWorkerResponse(
      JSON.stringify({ id, type: "result", value: "yes" }),
      id,
      "isAncestor",
    ),
  ).toThrow();
  expect(
    parseWorkerResponse(
      JSON.stringify({ id, type: "result", value: true }),
      id,
      "isAncestor",
    ),
  ).toEqual({ id, type: "result", value: true });
});

test("worker protocol carries correlated bounded activity frames", () => {
  expect(
    parseWorkerResponse(
      JSON.stringify({
        id,
        type: "activity",
        activity: "tool",
        text: "Read diff",
      }),
      id,
      "implement",
    ),
  ).toEqual({ id, type: "activity", activity: "tool", text: "Read diff" });
  for (const value of [
    { id: "wrong", type: "activity", activity: "note", text: "hello" },
    { id, type: "activity", activity: "thought", text: "hidden" },
    { id, type: "activity", activity: "note" },
    {
      id,
      type: "activity",
      activity: "note",
      text: "x".repeat(activityTextLimit + 1),
    },
  ]) {
    expect(() =>
      parseWorkerResponse(JSON.stringify(value), id, "implement"),
    ).toThrow();
  }
});

test("worker protocol accepts every note the normalizer can produce", () => {
  const stream = visibleActivityStream();
  const reported = stream.accept({
    text: `${"\u{1F600}".repeat(activityTextLimit)}\n`,
    type: "text_delta",
  });
  if (reported === null) throw new Error("Expected a normalized note");

  expect(
    parseWorkerResponse(
      JSON.stringify({ id, type: "activity", ...reported }),
      id,
      "implement",
    ),
  ).toMatchObject({ activity: "note" });
});
