/**
 * The frozen prototype's answer cases, kept as harness fixtures so the shipped
 * dashboard can be inspected against the approved reference. Test
 * infrastructure only; production never reads these strings.
 */
import type { AnswerBlock } from "../cli/ui/answer-block.js";
import type { Draft } from "../cli/ui/answer-draft.js";
import { graphemes } from "../cli/ui/text-cells.js";

export const shortQuestion =
  "Browser checks need missing system libraries. Should I continue with the available checks and record browser validation as blocked, or pause until the environment is fixed?";

export const longQuestion = [
  shortQuestion,
  "What I checked: Chromium is installed, but launching it exits before a page can open. The dependency inspection reports missing libglib-2.0.so.0, libnss3.so and libatk-1.0.so.0. Retrying with a different browser flag does not resolve missing shared libraries.",
  "Work completed: task creation and persistence are implemented. The unit checks cover empty input, duplicate titles, reload behavior and completion updates. Static markup checks cover input labels and button names. These checks cannot establish whether focus order, layout or contrast behave correctly in a real browser.",
  "Option 1 — Continue the implementation and run the checks available here. Record browser validation as blocked, retain the launch output and leave the visual and keyboard checks outstanding. This keeps implementation moving, but does not certify those checks as passed.",
  "Option 2 — Keep this run paused while the environment is repaired. Provide an environment with the required browser libraries, then resume the browser checks. This takes longer but allows the original validation plan to be completed before continuing.",
  "Scope of the decision: proceeding does not authorize installing system packages or changing the container image. It only tells the agent how to proceed with the validation work in the existing environment.",
  "Please say which option you prefer and whether there are any checks you require before the next task starts. If you choose to continue, should missing browser validation remain a blocker for final certification?",
].join("\n\n");

const multilineText = [
  "Continue with the available checks.",
  "",
  "Record browser validation as blocked and keep the launch output, then raise it again before the final certification of this plan.",
].join("\n");

export const multilineDraft: Draft = {
  cursor: graphemes(multilineText).length,
  text: multilineText,
};

export function answerBlock(
  question: string,
  draft: Draft,
  editing: boolean,
): AnswerBlock {
  return { draft, editing, notice: null, question };
}
