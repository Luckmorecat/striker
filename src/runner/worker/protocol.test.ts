import { expect, test } from "vitest";
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
