import { StringDecoder } from "node:string_decoder";

import { StdinBuffer } from "@earendil-works/pi-tui";
import type { RunJournalEvent } from "../../core/contracts.js";
import type {
  RunObservation,
  RunObservationPublisher,
} from "../../core/run-observation.js";
import type { AnswerInput } from "../terminal/answer-input.js";
import type { TerminalSession } from "../terminal/terminal-session.js";
import { blankNotice, type AnswerBlock } from "./answer-block.js";
import { emptyDraft } from "./answer-draft.js";
import { renderDashboard, type DashboardView } from "./progress-dashboard.js";
import { dashboardCommand, type DashboardCommand } from "./progress-keys.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
  type PlanTaskSeed,
  type ProgressSeed,
  type ProgressState,
  withPlan,
} from "./progress-model.js";

const escape = "";
const hideCursor = `${escape}[?25l`;
const showCursor = `${escape}[?25h`;
const pasteStart = `${escape}[200~`;
const pasteEnd = `${escape}[201~`;
/** Bracketed paste plus key disambiguation, so a draft receives what was typed. */
const openInput = `${escape}[?2004h${escape}[>1u${escape}[>4;2m`;
const closeInput = `${escape}[?2004l${escape}[<u${escape}[>4;0m${showCursor}`;

export interface AnimationClock {
  start(tick: () => void): () => void;
}

export function intervalClock(milliseconds = 50): AnimationClock {
  return {
    start: (tick) => {
      const timer = setInterval(tick, milliseconds);
      timer.unref();
      return () => {
        clearInterval(timer);
      };
    },
  };
}

export interface ProgressSessionOptions {
  readonly clock: AnimationClock;
  readonly elapsed: () => number;
  readonly history?: readonly RunJournalEvent[];
  readonly observations: RunObservationPublisher;
  readonly onInterrupt?: () => void;
  readonly seed: ProgressSeed;
  readonly terminal: TerminalSession;
}

/** Owns the dashboard's terminal turn, including the answer appended to it. */
export class ProgressSession {
  #state: ProgressState;
  #view = {
    expanded: false,
    follow: false,
    frame: 0,
    motion: true,
    scroll: 0,
  };
  #answer: AnswerBlock | null = null;
  #settle: ((input: AnswerInput) => void) | null = null;
  #exitCode: 0 | 130 = 0;
  /** Rows the last frame showed, which is what a page key moves by. */
  #viewport = 1;
  #dirty = true;
  #disposed = false;
  #wasFlowing = false;
  #plainLine = "";
  #keys: StdinBuffer | null = null;
  #release: (() => void) | null = null;
  #stopClock: (() => void) | null = null;
  /** Plain output is decided once; a prompt handoff never switches to it. */
  readonly #plain: boolean;
  readonly #decoder = new StringDecoder("utf8");
  readonly #unsubscribe: () => void;
  readonly #onData = (chunk: Buffer | string) => {
    this.#keys?.process(
      typeof chunk === "string" ? chunk : this.#decoder.write(chunk),
    );
  };
  readonly #onEof = () => {
    this.dispose();
  };
  readonly #onResize = () => {
    this.#dirty = true;
  };

  static start(options: ProgressSessionOptions): ProgressSession {
    return new ProgressSession(options);
  }

  private constructor(private readonly options: ProgressSessionOptions) {
    this.#state = (options.history ?? []).reduce<ProgressState>(
      (state, event) => applyObservation(state, { event, kind: "journal" }),
      initialProgress(options.seed),
    );
    this.#plain = !options.terminal.interactive;
    this.#plainLine = this.#state.live;
    this.#unsubscribe = options.observations.subscribe({
      observe: (observation) => {
        this.#observe(observation);
      },
    });
    if (!this.#plain) this.#attach();
  }

  /** Fills the plan panel once a source parses after the display began. */
  plan(tasks: readonly PlanTaskSeed[]): void {
    if (this.#disposed) return;
    this.#state = withPlan(this.#state, tasks);
    this.#dirty = true;
  }

  /**
   * Appends the question, editor and hints after SESSION. The dashboard keeps
   * the terminal and the reader's place; focusing the draft reveals the caret
   * through the same scroll offset.
   */
  answer(question: string): Promise<AnswerInput> {
    return new Promise<AnswerInput>((resolve) => {
      if (this.#disposed || this.#plain) {
        resolve({ exitCode: 0, status: "cancelled" });
        return;
      }
      this.resume();
      this.#answer = {
        draft: emptyDraft,
        editing: false,
        notice: null,
        question,
      };
      this.#settle = resolve;
      this.#view = { ...this.#view, follow: false };
      this.#dirty = true;
      this.#paint("screen");
    });
  }

  /** Hands exclusive keyboard ownership to a prompt below the dashboard. */
  suspend(): void {
    if (this.#disposed || this.#release === null) return;
    this.#stopAnimation();
    this.#paint("block");
    this.#detach();
    this.options.terminal.output.write("\n");
  }

  resume(): void {
    if (this.#disposed || this.#release !== null || this.#plain) return;
    this.#dirty = true;
    this.#attach();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#stopAnimation();
    this.#finishAnswer({ exitCode: this.#exitCode, status: "cancelled" });
    if (this.#release === null) return;
    this.#paint("block");
    this.#detach();
    this.options.terminal.output.write("\n");
  }

  #observe(observation: RunObservation): void {
    if (this.#disposed) return;
    // Plain output is a lifecycle log; streamed agent text would drown it.
    if (this.#plain && observation.kind === "activity") return;
    this.#state = applyObservation(this.#state, observation);
    this.#dirty = true;
    if (this.#plain) this.#writePlain();
  }

  #writePlain(): void {
    if (this.#state.live === this.#plainLine) return;
    this.#plainLine = this.#state.live;
    this.options.terminal.output.write(`${this.#state.live}\n`);
  }

  #attach(): void {
    const { input, output } = this.options.terminal;
    this.#wasFlowing = input.readableFlowing === true;
    this.#release = this.options.terminal.acquire();
    const keys = new StdinBuffer();
    keys.on("data", (data) => {
      this.#key(data);
    });
    keys.on("paste", (text) => {
      this.#key(`${pasteStart}${text}${pasteEnd}`);
    });
    this.#keys = keys;
    input.on("data", this.#onData);
    input.once("end", this.#onEof);
    input.once("close", this.#onEof);
    output.on("resize", this.#onResize);
    input.setRawMode?.(true);
    input.resume();
    output.write(`${openInput}${hideCursor}`);
    this.#stopClock = this.options.clock.start(() => {
      this.#tick();
    });
  }

  #detach(): void {
    const release = this.#release;
    if (release === null) return;
    const { input, output } = this.options.terminal;
    this.#release = null;
    this.#keys?.destroy();
    this.#keys = null;
    input.off("data", this.#onData);
    input.off("end", this.#onEof);
    input.off("close", this.#onEof);
    output.off("resize", this.#onResize);
    input.setRawMode?.(false);
    output.write(closeInput);
    // A resumed stream would keep the process alive past the final summary.
    if (!this.#wasFlowing) input.pause();
    release();
  }

  #stopAnimation(): void {
    this.#stopClock?.();
    this.#stopClock = null;
  }

  #animating(): boolean {
    return this.#state.attention === null && this.#state.finished === null;
  }

  #tick(): void {
    this.#view = { ...this.#view, frame: this.#view.frame + 1 };
    if (!this.#dirty && !(this.#view.motion && this.#animating())) return;
    this.#dirty = false;
    this.#paint("screen");
  }

  #finishAnswer(input: AnswerInput): void {
    const settle = this.#settle;
    this.#answer = null;
    this.#settle = null;
    this.#dirty = true;
    settle?.(input);
  }

  /** Ctrl-C ends an answer with its own exit code; a run it interrupts. */
  #cancel(exitCode: 0 | 130): void {
    const answering = this.#settle !== null;
    this.#exitCode = exitCode;
    this.dispose();
    if (!answering) this.options.onInterrupt?.();
  }

  #submit(): void {
    const answer = this.#answer;
    if (answer === null) return;
    if (answer.draft.text.trim().length === 0) {
      this.#answer = { ...answer, notice: blankNotice };
      this.#view = { ...this.#view, follow: true };
      return;
    }
    this.#finishAnswer({ status: "submitted", text: answer.draft.text });
    this.#paint("screen");
  }

  #apply(command: DashboardCommand, answer: AnswerBlock | null): void {
    if (command.kind === "motion")
      this.#view = { ...this.#view, motion: !this.#view.motion };
    else if (command.kind === "expand")
      this.#view = { ...this.#view, expanded: !this.#view.expanded };
    else if (command.kind === "scroll")
      this.#view = {
        ...this.#view,
        follow: false,
        scroll:
          this.#view.scroll + command.rows + command.pages * this.#viewport,
      };
    else if (answer === null) return;
    else if (command.kind === "edit") {
      this.#answer = { ...answer, draft: command.draft, notice: null };
      this.#view = { ...this.#view, follow: true };
    } else if (command.kind === "focus") {
      this.#answer = { ...answer, editing: true };
      this.#view = { ...this.#view, follow: true };
    } else if (command.kind === "browse") {
      this.#answer = { ...answer, editing: false };
      this.#view = { ...this.#view, follow: false };
    }
  }

  #key(data: string): void {
    if (this.#disposed) return;
    const answer = this.#answer;
    const command = dashboardCommand(data, answer);
    if (command === null) return;
    if (command.kind === "cancel") {
      this.#cancel(command.exitCode);
      return;
    }
    if (command.kind === "submit") this.#submit();
    else this.#apply(command, answer);
    this.#dirty = true;
  }

  #paint(mode: "block" | "screen"): void {
    if (this.#release === null) return;
    const { output } = this.options.terminal;
    const model = dashboardModel(this.#state);
    const view: DashboardView = {
      ...(this.#answer === null ? {} : { answer: this.#answer }),
      columns: output.columns ?? 80,
      elapsedSeconds: this.options.elapsed(),
      rows: output.rows ?? 24,
      ...this.#view,
    };
    const frame = renderDashboard(model, view, mode);
    // Keep only the scroll this frame honoured, so overshooting never leaves
    // the keys dead.
    this.#view = { ...this.#view, scroll: frame.scroll };
    this.#viewport = frame.viewport;
    const caret = mode === "screen" ? frame.caret : null;
    output.write(
      `${escape}[H${frame.lines.join(`${escape}[K\r\n`)}${escape}[K${escape}[J${
        caret === null
          ? hideCursor
          : `${escape}[${String(caret.row + 1)};${String(caret.column + 1)}H${showCursor}`
      }`,
    );
  }
}
