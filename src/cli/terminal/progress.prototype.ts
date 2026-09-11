/** THROWAWAY: Refine the selected stage dashboard and active-stage shimmer.
 * Stage dashboard selected; discarded feed/focus. Everything is mocked.
 * Run pnpm prototype:progress. No Striker imports, Docker, network or writes.
 * Preserve on a throwaway branch after a design is selected; do not ship.
 */
import { emitKeypressEvents } from "node:readline";

interface Moment {
  stage: string;
  note: string;
  tool: string;
  detail: string;
}
interface Demo {
  frame: number;
  motion: boolean;
  step: number;
  playing: boolean;
  editing: boolean;
  answer: string;
  submitted: string;
  ticks: number;
  expanded: boolean;
}

// The mock timeline revisits stable pipeline stages after a blocking review.
const moments: readonly Moment[] = [
  {
    stage: "Preparing",
    note: "Opening the retained workspace.",
    tool: "Container ready",
    detail: "Mock session demo-42",
  },
  {
    stage: "Implementing",
    note: "Checking answer eligibility before input.",
    tool: "Read recovery-policy.ts",
    detail: "Round 1 · attempt 1",
  },
  {
    stage: "Needs attention",
    note: "Should blank answers reprompt, or leave the run paused?",
    tool: "Developer decision required",
    detail: "Suggested: reprompt.",
  },
  {
    stage: "Implementing",
    note: "Applying your decision to the answer editor.",
    tool: "Edit answer-command.ts",
    detail: "Same session · round 1",
  },
  {
    stage: "Verifying",
    note: "Checking the input flow.",
    tool: "Run pnpm check",
    detail: "Mock tests running",
  },
  {
    stage: "Standards review",
    note: "Verification passed. Reviewing project rules.",
    tool: "Read diff · 3 files",
    detail: "28 tests passed · candidate A",
  },
  {
    stage: "Standards review",
    note: "Review found 2 blocking issues. Returning to implementation.",
    tool: "Review completed · changes required",
    detail: "Automatic continuation; no developer input needed.",
  },
  {
    stage: "Implementing",
    note: "Fixing 2 blocking review findings · round 2.",
    tool: "Edit answer-command.ts",
    detail: "Candidate A changed; previous checks are outdated.",
  },
  {
    stage: "Verifying",
    note: "Rechecking the repaired input flow.",
    tool: "Run pnpm check",
    detail: "Round 2 · candidate B",
  },
  {
    stage: "Standards review",
    note: "Verification passed. Rechecking both blocking findings.",
    tool: "Review updated diff",
    detail: "Round 2 · candidate B",
  },
  {
    stage: "Plan review",
    note: "Both findings resolved. Checking task coverage.",
    tool: "Review completion evidence",
    detail: "Standards and verification passed on candidate B.",
  },
  {
    stage: "Completed",
    note: "Answer interaction completed and certified.",
    tool: "Export mock commit a1b2c3d",
    detail: "Task 2/5 complete after 2 implementation rounds.",
  },
];
const stages = [
  "Preparing",
  "Implementing",
  "Verifying",
  "Standards review",
  "Plan review",
  "Completed",
];
const stopped = (state: Demo) =>
  ["Needs attention", "Completed"].includes(current(state).stage);
const blocked = (state: Demo) => state.step >= 6 && state.step <= 8;

function pipeline(state: Demo): string[] {
  const event = current(state);
  const stageIndex = stages.indexOf(
    event.stage === "Needs attention" ? "Implementing" : event.stage,
  );
  return stages.map((stage, index) => {
    if (stage === "Standards review" && blocked(state))
      return `! ${stage} · ${state.step > 6 ? "recheck due" : "2 blockers"}`;
    if (stage === "Verifying" && state.step === 7)
      return `↻ ${stage} · recheck required`;
    if (stage === "Implementing" && event.stage === "Needs attention")
      return `? ${stage} · needs attention`;
    if (index === stageIndex && event.stage !== "Completed")
      return `● ${stage}${state.step >= 7 ? " · round 2" : ""}`;
    return `${index <= stageIndex ? "✓" : "·"} ${stage}`;
  });
}

function findings(state: Demo): string[] {
  if (state.step < 6) return [];
  if (state.step >= 10)
    return ["✓ Review history · round 1: 2 blockers → round 2: resolved"];
  return [
    state.step === 9
      ? "RECHECKING · 2 findings from round 1"
      : "! REVIEW · 2 blocking findings from round 1",
    "  • Input consumed before eligibility is checked",
    "  • Cancelled input incorrectly resumes the session",
  ];
}

const current = (state: Demo): Moment =>
  moments[state.step] ?? { stage: "Preparing", note: "", tool: "", detail: "" };
const clock = (ticks: number) =>
  `${String(Math.floor(ticks / 60))}:${String(ticks % 60).padStart(2, "0")}`;
const clip = (text: string, width: number) =>
  Array.from(text).length > width
    ? Array.from(text)
        .slice(0, Math.max(0, width - 1))
        .join("") + "…"
    : text;
const pad = (text: string, width: number) => clip(text, width).padEnd(width);

function dashboard(state: Demo, width: number): string[] {
  const event = current(state);
  const left = [
    `PLAN / ${current(state).stage === "Completed" ? "2" : "1"} of 5 certified`,
    "",
    "✓ 01  Recovery contracts",
    `${current(state).stage === "Completed" ? "✓" : "●"} 02  Answer command`,
    "· 03  Terminal handoff",
    "· 04  Recovery guidance",
    "· 05  Documentation",
    "",
    "SESSION demo-42",
    "Attempt 1 · Docker (mock)",
  ];
  const right = ["TASK PIPELINE", "", ...pipeline(state)];
  const columns = width >= 76;
  return [
    `STRIKER / run overview · ${clock(state.ticks)} simulated elapsed`,
    "",
    ...(columns
      ? left.map((line, index) => `${pad(line, 32)} │ ${right[index] ?? ""}`)
      : right),
    "",
    ...findings(state),
    `LIVE · ${event.note}`,
    `TOOL · ${event.tool}`,
    ...(state.expanded ? [event.detail] : []),
  ];
}

function prompt(state: Demo): string[] {
  if (state.editing)
    return [
      "ANSWER / mocked; nothing is sent",
      `> ${state.answer}▏`,
      "Enter submits · Esc cancels · type your decision",
    ];
  if (current(state).stage === "Needs attention")
    return [
      "? Should blank answers reprompt, or leave the run paused?",
      "[a] Write answer   [Enter] Use ‘Reprompt’   [n] Mock answer",
    ];
  if (state.submitted) return [`Decision: ${state.submitted}`];
  return [];
}

// Paint after clipping so escape sequences never count as visible columns.
function shimmer(line: string, state: Demo, baseColor: string): string {
  const label = `● ${current(state).stage}`;
  const start = line.indexOf(label);
  if (start < 0 || !state.motion || stopped(state)) return line;
  const characters = Array.from(label);
  const center = ((state.frame * 0.35) % (characters.length + 12)) - 6;
  const painted = characters
    .map((character, index) => {
      const distance = Math.abs(index - center);
      const shade =
        distance < 1 ? 231 : distance < 2 ? 195 : distance < 3 ? 153 : 67;
      return `\x1b[38;5;${String(shade)}m${character}`;
    })
    .join("");
  return `${line.slice(0, start)}${painted}\x1b[${baseColor}m${line.slice(start + label.length)}`;
}

function render(state: Demo): void {
  const width = Math.max(20, (process.stdout.columns || 100) - 2);
  const height = process.stdout.rows || 30;
  const body = dashboard(state, width);
  const footer = [
    "─".repeat(width),
    ...prompt(state),
    "PROTOTYPE · Stage dashboard · ALL DATA MOCKED",
    "n/b step · f review failure · Space play · m motion · d detail · q quit",
    `State: ${current(state).stage} | step ${String(state.step + 1)}/${String(moments.length)} | ${state.playing ? "autoplay" : "manual"} | motion ${state.motion ? "on" : "off"} | ${state.editing ? "editing answer" : "navigation"}`,
  ];
  const room = Math.max(1, height - footer.length - 1);
  const content = [
    ...body.slice(0, room),
    ...Array<string>(Math.max(0, room - body.length)).fill(""),
    ...footer,
  ];
  const paint = (line: string) => {
    const color = line.startsWith("PROTOTYPE")
      ? "7"
      : /Needs attention|^\?|ANSWER/.test(line)
        ? "33"
        : /●|LIVE/.test(line)
          ? "36"
          : "0";
    const painted = shimmer(clip(line, width), state, color)
      .replace("! Standards review", "\x1b[31m! Standards review")
      .replace("! REVIEW", "\x1b[31m! REVIEW")
      .replace(/✓[^│]*/gu, (text) => `\x1b[32m${text}\x1b[${color}m`);
    return `\x1b[${color}m${painted}\x1b[0m`;
  };
  process.stdout.write(
    `\x1b[H${content.map(paint).join("\x1b[K\r\n")}\x1b[K\x1b[J`,
  );
}

function advance(state: Demo, delta = 1): void {
  state.step = Math.max(0, Math.min(moments.length - 1, state.step + delta));
  state.ticks = state.step * 12;
  if (stopped(state)) state.playing = false;
}

function editAnswer(state: Demo, text: string, key: { name?: string }): void {
  if (key.name === "escape") state.editing = false;
  else if (key.name === "return" && state.answer.trim()) {
    state.submitted = state.answer;
    state.editing = false;
    advance(state);
  } else if (key.name === "backspace")
    state.answer = Array.from(state.answer).slice(0, -1).join("");
  else if (
    text &&
    Array.from(text).every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    )
  )
    state.answer += text;
}

function navigate(state: Demo, key: string): void {
  if (key === "n" || key === "b") advance(state, key === "n" ? 1 : -1);
  else if (key === "f") {
    state.step = 6;
    state.ticks = 72;
    state.playing = false;
  } else if (key === "m") state.motion = !state.motion;
  else scenarioKey(state, key);
}

function scenarioKey(state: Demo, key: string): void {
  if (key === "space") state.playing = !state.playing && !stopped(state);
  else if (key === "d") state.expanded = !state.expanded;
  else if (key === "a" && current(state).stage === "Needs attention")
    state.editing = true;
  else if (key === "return" && current(state).stage === "Needs attention") {
    state.submitted = "Reprompt on blank answers.";
    advance(state);
  } else if (key === "r")
    Object.assign(state, {
      step: 0,
      ticks: 0,
      playing: false,
      submitted: "",
      answer: "",
    });
}

function main(): void {
  const state: Demo = {
    frame: 0,
    motion: true,
    step: 1,
    playing: false,
    editing: false,
    answer: "",
    submitted: "",
    ticks: 12,
    expanded: false,
  };
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("Open in a terminal: pnpm prototype:progress\n");
    return;
  }
  emitKeypressEvents(process.stdin);
  const raw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  const timer = setInterval(() => {
    state.frame++;
    if (state.playing && !state.editing && state.frame % 20 === 0) {
      state.ticks++;
      if (state.ticks % 12 === 0) advance(state);
    }
    if (state.playing || (state.motion && !stopped(state))) render(state);
  }, 50);
  const cleanup = () => {
    clearInterval(timer);
    process.stdin.setRawMode(raw);
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", () => process.exit(0));
  process.once("SIGINT", () => process.exit(0));
  process.stdin.on(
    "keypress",
    (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (
        (key.ctrl && key.name === "c") ||
        (!state.editing && key.name === "q")
      )
        process.exit(0);
      if (state.editing) editAnswer(state, text, key);
      else navigate(state, key.name ?? text);
      render(state);
    },
  );
  process.stdout.on("resize", () => {
    render(state);
  });
  render(state);
}

main();
