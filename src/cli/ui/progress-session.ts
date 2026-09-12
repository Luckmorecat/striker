import { StringDecoder } from "node:string_decoder";

import type { RunJournalEvent } from "../../core/contracts.js";
import type {
  RunObservation,
  RunObservationPublisher,
} from "../../core/run-observation.js";
import type { TerminalSession } from "../terminal/terminal-session.js";
import { effectiveScroll, renderDashboard } from "./progress-dashboard.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
  type PlanTaskSeed,
  type ProgressSeed,
  type ProgressState,
  withPlan,
} from "./progress-model.js";

const escape = "\u001B";
const hideCursor = `${escape}[?25l`;
const showCursor = `${escape}[?25h`;

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

/** Owns the dashboard's terminal turn; prompts take it back through suspend. */
export class ProgressSession {
  #state: ProgressState;
  #view = { expanded: false, frame: 0, motion: true, scroll: 0 };
  #dirty = true;
  #disposed = false;
  #wasFlowing = false;
  #plainLine = "";
  #release: (() => void) | null = null;
  #stopClock: (() => void) | null = null;
  /** Plain output is decided once; a prompt handoff never switches to it. */
  readonly #plain: boolean;
  readonly #decoder = new StringDecoder("utf8");
  readonly #unsubscribe: () => void;
  readonly #onData = (chunk: Buffer | string) => {
    this.#key(typeof chunk === "string" ? chunk : this.#decoder.write(chunk));
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

  /** Hands exclusive keyboard ownership to a prompt below the dashboard. */
  suspend(): void {
    if (this.#disposed || this.#release === null) return;
    this.#stopAnimation();
    this.#paint("block");
    this.options.terminal.output.write("\n");
    this.#detach();
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
    if (this.#release === null) return;
    this.#paint("block");
    this.options.terminal.output.write(`\n${showCursor}`);
    this.#detach();
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
    input.on("data", this.#onData);
    input.once("end", this.#onEof);
    input.once("close", this.#onEof);
    output.on("resize", this.#onResize);
    input.setRawMode?.(true);
    input.resume();
    output.write(hideCursor);
    this.#stopClock = this.options.clock.start(() => {
      this.#tick();
    });
  }

  #detach(): void {
    const release = this.#release;
    if (release === null) return;
    const { input, output } = this.options.terminal;
    this.#release = null;
    input.off("data", this.#onData);
    input.off("end", this.#onEof);
    input.off("close", this.#onEof);
    output.off("resize", this.#onResize);
    input.setRawMode?.(false);
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

  /** Motion and detail only; q never cancels an executing run. */
  #key(data: string): void {
    if (data === "\u0003") {
      // The interrupt may end the process at once: restore the terminal first.
      this.dispose();
      this.options.onInterrupt?.();
      return;
    }
    if (data === "m")
      this.#view = { ...this.#view, motion: !this.#view.motion };
    else if (data === "d")
      this.#view = {
        ...this.#view,
        expanded: !this.#view.expanded,
        scroll: 0,
      };
    else if (
      this.#view.expanded &&
      (data === `${escape}[A` || data === `${escape}[B`)
    )
      // Negative values scroll the plan window above its centred position.
      this.#view = {
        ...this.#view,
        scroll: this.#view.scroll + (data.endsWith("A") ? -1 : 1),
      };
    else return;
    this.#dirty = true;
  }

  #paint(mode: "block" | "screen"): void {
    if (this.#release === null) return;
    const { output } = this.options.terminal;
    const model = dashboardModel(this.#state);
    const view = {
      columns: output.columns ?? 80,
      elapsedSeconds: this.options.elapsed(),
      rows: output.rows ?? 24,
      ...this.#view,
    };
    const lines = renderDashboard(model, view, mode);
    // Keep only the scroll this frame honoured, so overshooting never leaves
    // the arrows dead.
    this.#view = { ...this.#view, scroll: effectiveScroll(model, view) };
    output.write(
      `${escape}[H${lines.join(`${escape}[K\r\n`)}${escape}[K${escape}[J`,
    );
  }
}
