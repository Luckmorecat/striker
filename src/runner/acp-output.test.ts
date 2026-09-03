import type { AcpRuntimeEvent } from "acpx/runtime";
import { describe, expect, it } from "vitest";

import { collectFinalMessage, collectWholeOutput } from "./acp-output.js";

function events(
  ...items: readonly AcpRuntimeEvent[]
): AsyncIterable<AcpRuntimeEvent> {
  return (async function* () {
    await Promise.resolve();
    for (const item of items) yield item;
  })();
}

describe("ACP whole-output collection", () => {
  it("joins all visible chunks and ignores thought chunks", async () => {
    const output = await collectWholeOutput(
      events(
        { messageId: "commentary", text: "Working", type: "text_delta" },
        { stream: "thought", text: "secret", type: "text_delta" },
        { messageId: "result", text: "Done", type: "text_delta" },
      ),
    );

    expect(output).toBe("WorkingDone");
  });
});

describe("ACP final-message collection", () => {
  it("joins multiple chunks carrying one message ID", async () => {
    const output = await collectFinalMessage(
      events(
        { messageId: "result", text: '{"kind":', type: "text_delta" },
        { messageId: "result", text: '"implementation"}', type: "text_delta" },
      ),
    );

    expect(output).toBe('{"kind":"implementation"}');
  });

  it("returns only the last identified message", async () => {
    const output = await collectFinalMessage(
      events(
        { messageId: "commentary", text: "Working...", type: "text_delta" },
        {
          messageId: "result",
          text: '{"kind":"implementation"}',
          type: "text_delta",
        },
      ),
    );

    expect(output).toBe('{"kind":"implementation"}');
  });

  it("ignores thought chunks when selecting the final message", async () => {
    const output = await collectFinalMessage(
      events(
        { messageId: "result", text: "completion", type: "text_delta" },
        {
          messageId: "later-thought",
          stream: "thought",
          text: "internal",
          type: "text_delta",
        },
      ),
    );

    expect(output).toBe("completion");
  });

  it.each([
    [
      "fully unidentified",
      [
        { text: "legacy ", type: "text_delta" } as const,
        { text: "output", type: "text_delta" } as const,
      ],
    ],
    [
      "mixed identified and unidentified",
      [
        {
          messageId: "commentary",
          text: "Working. ",
          type: "text_delta",
        } as const,
        { text: "Result.", type: "text_delta" } as const,
      ],
    ],
  ])("retains legacy aggregation for a %s stream", async (_name, items) => {
    await expect(collectFinalMessage(events(...items))).resolves.toBe(
      items.map((item) => item.text).join(""),
    );
  });

  it("returns an empty string when there is no visible text", async () => {
    await expect(
      collectFinalMessage(
        events({ stream: "thought", text: "internal", type: "text_delta" }),
      ),
    ).resolves.toBe("");
  });
});
