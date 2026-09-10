import {
  Editor,
  matchesKey,
  Text,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import type { RecoveryInspection } from "../../core/recovery-operations.js";
import { attentionView } from "./attention-view.js";
import { PiTerminal } from "./pi-terminal.js";
import type { TerminalSession } from "./terminal-session.js";

export type AnswerInput =
  | { readonly status: "submitted"; readonly text: string }
  | { readonly status: "cancelled"; readonly exitCode: 0 | 130 };
const plain = (text: string) => text;

const editorTheme = {
  borderColor: plain,
  selectList: {
    selectedPrefix: plain,
    selectedText: plain,
    description: plain,
    scrollInfo: plain,
    noMatch: plain,
  },
};

export function composeAnswer(
  session: TerminalSession,
  context: RecoveryInspection,
): Promise<AnswerInput> {
  const release = session.acquire();
  return new Promise<AnswerInput>((resolve, reject) => {
    let settled = false;
    const terminal = new PiTerminal(
      session,
      (error) => {
        finish(undefined, error);
      },
      () => {
        finish({ status: "cancelled", exitCode: 0 });
      },
    );
    const tui = new TuiMainScreen(terminal, true);
    function finish(result?: AnswerInput, error?: unknown) {
      if (settled) return;
      settled = true;
      try {
        tui.stop();
      } catch (cleanupError) {
        error ??= cleanupError;
      } finally {
        try {
          terminal.stop();
        } catch (cleanupError) {
          error ??= cleanupError;
        } finally {
          release();
        }
      }
      if (error !== undefined)
        reject(
          error instanceof Error
            ? error
            : new Error("Terminal input failed", { cause: error }),
        );
      else if (result !== undefined) resolve(result);
    }
    const editor = new Editor(tui, editorTheme);
    const hint = new Text(
      "Enter: submit · Shift+Enter / Alt+Enter: newline\nCtrl-C / Ctrl-D: leave paused",
      0,
      0,
    );
    tui.addChild(editor);
    tui.addChild(hint);
    tui.setFocus(editor);
    tui.addInputListener((data) => {
      if (settled) return { consume: true };
      if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
        finish({
          status: "cancelled",
          exitCode: matchesKey(data, "ctrl+c") ? 130 : 0,
        });
        return { consume: true };
      }
      if (matchesKey(data, "enter")) {
        // Capture before Pi's submitValue trims/resets and avoid its backslash shortcut.
        const text = editor.getExpandedText();
        if (text.trim().length > 0) finish({ status: "submitted", text });
        else {
          hint.setText(
            "Answer cannot be blank. Enter a decision.\nEnter: submit · Shift+Enter / Alt+Enter: newline · Ctrl-C / Ctrl-D: leave paused",
          );
          tui.requestRender();
        }
        return { consume: true };
      }
      return undefined;
    });
    try {
      session.output.write(attentionView(context));
      tui.start();
    } catch (error) {
      finish(undefined, error);
    }
  });
}
