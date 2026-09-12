import type { AcpRuntimeEvent } from "acpx/runtime";

import type { RunActivity, RunObserver } from "../core/run-observation.js";
import type { StreamWatcher } from "./acp-output.js";

/** The display contract owns the shape; this module only normalizes into it. */
export type VisibleActivity = RunActivity;

/** Activity is ephemeral display text; a frame never carries a transcript. */
export const activityTextLimit = 160;

export interface ActivityStream {
  accept(event: AcpRuntimeEvent): VisibleActivity | null;
}

const escape = "\u001B";
/** A CSI sequence, an OSC introducer with its payload, or a lone escape. */
const sequenceHead = /^(?:\[[\d;?]*[ -/]*[@-~]|\][^\p{Cc}]*|.)/u;
const controls = /[\p{Cc}\p{Cf}]/gu;

function withoutEscapeSequences(text: string): string {
  return text
    .split(escape)
    .map((part, index) => (index === 0 ? part : part.replace(sequenceHead, "")))
    .join("");
}

/** Agent text is content: escapes and controls never reach the terminal. */
function sanitize(text: string): string {
  return withoutEscapeSequences(text)
    .replaceAll(controls, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** Bounded in the units the wire schema counts, never splitting a character. */
function clip(text: string): string {
  if (text.length <= activityTextLimit) return text;
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > activityTextLimit - 1) break;
    kept += character;
  }
  return `${kept}…`;
}

function report(
  activity: VisibleActivity["activity"],
  text: string,
): VisibleActivity | null {
  const clean = sanitize(text);
  return clean === "" ? null : { activity, text: clip(clean) };
}

/** Only the newest complete line is shown; the rest have already passed. */
function newest(lines: readonly string[]): VisibleActivity | null {
  for (const line of [...lines].reverse()) {
    const reported = report("note", line);
    if (reported !== null) return reported;
  }
  return null;
}

/** Accumulates chunked output and reports whole lines, never fragments. */
export function visibleActivityStream(): ActivityStream {
  let pending = "";
  let pendingMessage: string | undefined;
  let lastTool: string | null = null;
  return {
    accept: (event) => {
      if (event.type === "tool_call") {
        const reported = report("tool", event.title ?? event.text);
        if (reported === null || reported.text === lastTool) return null;
        lastTool = reported.text;
        return reported;
      }
      if (event.type !== "text_delta" || event.stream === "thought")
        return null;
      // A new message ends the previous one as surely as a line break does.
      // Whatever the last message leaves unterminated stays pending, so a
      // single-line final result is never shown as a note.
      if (pending !== "" && event.messageId !== pendingMessage) pending += "\n";
      pendingMessage = event.messageId;
      pending += event.text;
      const lastBreak = pending.lastIndexOf("\n");
      if (lastBreak === -1) {
        if (pending.length <= activityTextLimit) return null;
        const overflowed = pending;
        pending = "";
        return report("note", overflowed);
      }
      const completed = pending.slice(0, lastBreak).split("\n");
      pending = pending.slice(lastBreak + 1);
      return newest(completed);
    },
  };
}

/** One normalizer per turn: its listeners end when the event stream does. */
export function activityWatcher(observer: RunObserver): StreamWatcher {
  const activity = visibleActivityStream();
  return (event) => {
    const reported = activity.accept(event);
    if (reported !== null) observer.observe({ ...reported, kind: "activity" });
  };
}
