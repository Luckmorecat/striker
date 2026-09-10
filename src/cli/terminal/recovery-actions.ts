import { matchesKey, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import type { RecoveryInspection } from "../../core/recovery-operations.js";
import type { RecoveryAction } from "../../core/recovery-policy.js";
import {
  recoveryGuidance,
  type RecoveryChoice,
} from "../interactive-controller.js";
import { attentionView } from "./attention-view.js";
import { PiTerminal } from "./pi-terminal.js";
import type { TerminalSession } from "./terminal-session.js";

const labels = { answer: "Answer", resume: "Resume repair", retry: "Retry" };
export function chooseRecoveryAction(
  session: TerminalSession,
  context: RecoveryInspection,
): Promise<RecoveryChoice> {
  const release = session.acquire();
  return new Promise((resolve, reject) => {
    let settled = false;
    let selected = 0;
    const actions = (Object.keys(labels) as RecoveryAction[]).filter(
      (action) => context.availability[action] === null,
    );
    const choices = [
      ...actions.map((action) => labels[action]),
      "Leave paused",
    ];
    const terminal = new PiTerminal(
      session,
      (error) => {
        finish(undefined, error);
      },
      () => {
        finish({ exitCode: 0 });
      },
    );
    const tui = new TuiMainScreen(terminal, true);
    function finish(choice?: RecoveryChoice, error?: unknown) {
      if (settled) return;
      settled = true;
      try {
        tui.stop();
      } catch (cleanupError) {
        error ??= cleanupError;
      }
      try {
        terminal.stop();
      } catch (cleanupError) {
        error ??= cleanupError;
      }
      release();
      if (error !== undefined)
        reject(
          error instanceof Error
            ? error
            : new Error("Terminal input failed", { cause: error }),
        );
      else if (choice !== undefined) resolve(choice);
    }
    const menu = new Text("", 0, 0);
    const render = () => {
      menu.setText(menuText(choices, selected));
      tui.requestRender();
    };
    tui.addChild(menu);
    tui.addInputListener((data) => {
      if (settled) return { consume: true };
      if (matchesKey(data, "ctrl+c")) finish({ exitCode: 130 });
      else if (matchesKey(data, "ctrl+d")) finish({ exitCode: 0 });
      else if (matchesKey(data, "enter"))
        finish(actions[selected] ?? { exitCode: 0 });
      else if (matchesKey(data, "up")) selected = Math.max(0, selected - 1);
      else if (matchesKey(data, "down"))
        selected = Math.min(choices.length - 1, selected + 1);
      render();
      return { consume: true };
    });
    try {
      session.output.write(attentionView(context));
      if (actions.length === 0)
        session.output.write(`${recoveryGuidance(context)}\n`);
      render();
      tui.start();
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function menuText(choices: readonly string[], selected: number): string {
  return (
    choices
      .map((label, index) => `${index === selected ? ">" : " "} ${label}`)
      .join("\n") +
    "\n↑/↓: choose · Enter: select · Ctrl-C / Ctrl-D: leave paused"
  );
}
