import { matchesKey } from "@earendil-works/pi-tui";
import type { AnswerBlock } from "./answer-block.js";
import { editDraft, type Draft } from "./answer-draft.js";

/**
 * What a key asked the dashboard to do. Editing keeps ordinary characters,
 * so `m` and `d` reach the draft instead of toggling the display.
 */
export type DashboardCommand =
  | { readonly kind: "browse" }
  | { readonly kind: "cancel"; readonly exitCode: 0 | 130 }
  | { readonly kind: "edit"; readonly draft: Draft }
  | { readonly kind: "expand" }
  | { readonly kind: "focus" }
  | { readonly kind: "motion" }
  | { readonly kind: "scroll"; readonly pages: number; readonly rows: number }
  | { readonly kind: "submit" };

function scroll(rows: number, pages: number): DashboardCommand {
  return { kind: "scroll", pages, rows };
}

/** Paging moves the one document whether the operator is reading or typing. */
function sharedCommand(data: string): DashboardCommand | null {
  if (matchesKey(data, "ctrl+c")) return { exitCode: 130, kind: "cancel" };
  if (matchesKey(data, "pageUp")) return scroll(0, -1);
  if (matchesKey(data, "pageDown")) return scroll(0, 1);
  return null;
}

/**
 * The draft claims every key it can use before Enter is read as a submission,
 * so a modified Enter inserts a newline even where the terminal reports it in
 * a form the plain Enter matcher would also accept.
 */
function editingCommand(
  data: string,
  answer: AnswerBlock,
): DashboardCommand | null {
  if (matchesKey(data, "ctrl+d")) return { exitCode: 0, kind: "cancel" };
  if (matchesKey(data, "escape")) return { kind: "browse" };
  const draft = editDraft(answer.draft, data);
  if (draft !== null) return { draft, kind: "edit" };
  return matchesKey(data, "enter") ? { kind: "submit" } : null;
}

function browsingCommand(
  data: string,
  answer: AnswerBlock | null,
): DashboardCommand | null {
  if (answer !== null && matchesKey(data, "ctrl+d"))
    return { exitCode: 0, kind: "cancel" };
  if (answer !== null && matchesKey(data, "tab")) return { kind: "focus" };
  if (matchesKey(data, "up")) return scroll(-1, 0);
  if (matchesKey(data, "down")) return scroll(1, 0);
  if (data === "m") return { kind: "motion" };
  if (data === "d") return { kind: "expand" };
  return null;
}

export function dashboardCommand(
  data: string,
  answer: AnswerBlock | null,
): DashboardCommand | null {
  return (
    sharedCommand(data) ??
    (answer?.editing === true
      ? editingCommand(data, answer)
      : browsingCommand(data, answer))
  );
}
