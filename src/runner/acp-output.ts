import type { AcpRuntimeEvent } from "acpx/runtime";

function isVisibleText(
  event: AcpRuntimeEvent,
): event is Extract<AcpRuntimeEvent, { type: "text_delta" }> {
  return event.type === "text_delta" && event.stream !== "thought";
}

export async function collectWholeOutput(
  events: AsyncIterable<AcpRuntimeEvent>,
): Promise<string> {
  let output = "";
  for await (const event of events) {
    if (isVisibleText(event)) output += event.text;
  }
  return output;
}

export async function collectFinalMessage(
  events: AsyncIterable<AcpRuntimeEvent>,
): Promise<string> {
  let output = "";
  let hasUnidentifiedChunk = false;
  let lastMessageId: string | undefined;
  const messages = new Map<string, string>();

  for await (const event of events) {
    if (!isVisibleText(event)) continue;
    output += event.text;
    if (event.messageId === undefined) {
      hasUnidentifiedChunk = true;
      continue;
    }
    lastMessageId = event.messageId;
    messages.set(
      event.messageId,
      (messages.get(event.messageId) ?? "") + event.text,
    );
  }

  if (hasUnidentifiedChunk || lastMessageId === undefined) return output;
  return messages.get(lastMessageId) ?? "";
}
