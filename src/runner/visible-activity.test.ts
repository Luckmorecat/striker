import type { AcpRuntimeEvent } from "acpx/runtime";
import { describe, expect, it } from "vitest";

import {
  activityTextLimit,
  visibleActivityStream,
} from "./visible-activity.js";

describe("visible activity", () => {
  it("reports a completed line of visible output as a note", () => {
    const stream = visibleActivityStream();

    expect(stream.accept({ text: "Reading ", type: "text_delta" })).toBeNull();
    expect(
      stream.accept({ text: "recovery.ts\n", type: "text_delta" }),
    ).toEqual({ activity: "note", text: "Reading recovery.ts" });
  });
});

describe("visible activity exclusions", () => {
  it("never reports thought text and never mixes it into notes", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        stream: "thought",
        text: "secret plan\n",
        type: "text_delta",
      }),
    ).toBeNull();
    expect(
      stream.accept({
        text: "Editing answer-command.ts\n",
        type: "text_delta",
      }),
    ).toEqual({ activity: "note", text: "Editing answer-command.ts" });
  });

  it("reports the newest line when several complete together", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({ text: "first\nsecond\n\n", type: "text_delta" }),
    ).toEqual({ activity: "note", text: "second" });
  });

  it("reports nothing for a stream carrying only blank lines", () => {
    const stream = visibleActivityStream();

    expect(stream.accept({ text: "\n   \n", type: "text_delta" })).toBeNull();
  });
});

describe("visible activity bounds", () => {
  it("renders agent text as content, never as terminal instructions", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        text: "[2JCleared[31m red tail\n",
        type: "text_delta",
      }),
    ).toEqual({ activity: "note", text: "Cleared red tail" });
  });

  it("clips a line longer than the activity limit", () => {
    const stream = visibleActivityStream();

    const reported = stream.accept({
      text: `${"x".repeat(activityTextLimit + 40)}\n`,
      type: "text_delta",
    });

    expect(reported?.text).toHaveLength(activityTextLimit);
    expect(reported?.text.endsWith("…")).toBe(true);
  });

  it("reports bounded progress when the agent never breaks a line", () => {
    const stream = visibleActivityStream();

    const reported = stream.accept({
      text: "y".repeat(activityTextLimit * 3),
      type: "text_delta",
    });

    expect(reported?.text).toHaveLength(activityTextLimit);
    expect(stream.accept({ text: "z\n", type: "text_delta" })).toEqual({
      activity: "note",
      text: "z",
    });
  });
});

describe("visible activity tools", () => {
  it("reports a tool call by its title", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        text: "read",
        title: "Read recovery-policy.ts",
        toolCallId: "t1",
        type: "tool_call",
      }),
    ).toEqual({ activity: "tool", text: "Read recovery-policy.ts" });
  });

  it("falls back to the event text when a tool call has no title", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        text: "Run pnpm check",
        toolCallId: "t1",
        type: "tool_call",
      }),
    ).toEqual({ activity: "tool", text: "Run pnpm check" });
  });

  it("reports nothing when a tool call update repeats its summary", () => {
    const stream = visibleActivityStream();

    stream.accept({
      text: "",
      title: "Edit answer-command.ts",
      type: "tool_call",
    });

    expect(
      stream.accept({
        status: "completed",
        text: "",
        title: "Edit answer-command.ts",
        type: "tool_call",
      }),
    ).toBeNull();
  });

  it("reports nothing for status and terminal compatibility events", () => {
    const stream = visibleActivityStream();
    const ignored: readonly AcpRuntimeEvent[] = [
      { text: "context 40%", type: "status" },
      { stopReason: "end_turn", type: "done" },
      { message: "failed", type: "error" },
    ];

    expect(ignored.map((event) => stream.accept(event))).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("visible activity message boundaries", () => {
  it("completes a note when the agent starts its next message", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        messageId: "commentary",
        text: "Checking repository standards.",
        type: "text_delta",
      }),
    ).toBeNull();
    expect(
      stream.accept({
        messageId: "result",
        text: '{"verdict":"passed"}',
        type: "text_delta",
      }),
    ).toEqual({ activity: "note", text: "Checking repository standards." });
  });

  it("reports nothing while a message is still unterminated", () => {
    const stream = visibleActivityStream();

    stream.accept({
      messageId: "result",
      text: '{"kind":',
      type: "text_delta",
    });

    expect(
      stream.accept({
        messageId: "result",
        text: '"implementation"}',
        type: "text_delta",
      }),
    ).toBeNull();
  });
});

describe("visible activity wire bounds", () => {
  it("clips so that even astral text stays inside the frame bound", () => {
    const stream = visibleActivityStream();

    const reported = stream.accept({
      text: `${"\u{1F600}".repeat(activityTextLimit)}\n`,
      type: "text_delta",
    });

    expect(reported?.text.length).toBeLessThanOrEqual(activityTextLimit);
    expect(reported?.text.endsWith("…")).toBe(true);
    expect(Array.from(reported?.text ?? "")).not.toContain("�");
  });
});

describe("visible activity and the turn result", () => {
  it("shows the interior lines of a multi-line result, bounded to one line", () => {
    const stream = visibleActivityStream();

    expect(
      stream.accept({
        messageId: "result",
        text: '{\n  "verdict": "passed"\n}',
        type: "text_delta",
      }),
    ).toEqual({ activity: "note", text: '"verdict": "passed"' });
  });
});
