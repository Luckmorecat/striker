import { StringDecoder } from "node:string_decoder";
import { StdinBuffer, type Terminal } from "@earendil-works/pi-tui";
import type { TerminalSession } from "./terminal-session.js";

/** Pi terminal protocol over injected streams; never touches process streams. */
export class PiTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  private cleanup: (() => void) | undefined;
  constructor(
    private readonly session: TerminalSession,
    private readonly fail: (error: unknown) => void,
    private readonly eof: () => void,
  ) {}

  start(onInput: (data: string) => void, onResize: () => void): void {
    const { input, output } = this.session;
    const wasRaw = input.isRaw ?? false;
    const wasFlowing = input.readableFlowing === true;
    const buffer = new StdinBuffer();
    const decoder = new StringDecoder("utf8");
    const data = (chunk: Buffer | string) => {
      try {
        buffer.process(
          typeof chunk === "string" ? chunk : decoder.write(chunk),
        );
      } catch (error) {
        this.fail(error);
      }
    };
    buffer.on("data", onInput);
    buffer.on("paste", (text) => {
      onInput(`\x1b[200~${text}\x1b[201~`);
    });
    this.cleanup = () => {
      buffer.destroy();
      input.off("data", data);
      input.off("end", this.eof);
      input.off("close", this.eof);
      input.off("error", this.fail);
      output.off("error", this.fail);
      output.off("resize", onResize);
      input.setRawMode?.(wasRaw);
      if (!wasFlowing) input.pause();
    };
    input.on("data", data);
    input.once("end", this.eof);
    input.once("close", this.eof);
    input.on("error", this.fail);
    output.on("error", this.fail);
    output.on("resize", onResize);
    input.setRawMode?.(true);
    input.resume();
    // Push keyboard disambiguation without changing Pi's global key manager.
    this.write("\x1b[?2004h\x1b[>1u\x1b[>4;2m");
    if (input.readableEnded || input.destroyed)
      queueMicrotask(() => {
        if (this.cleanup !== undefined) this.eof();
      });
  }
  stop(): void {
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    if (cleanup === undefined) return;
    cleanup();
    this.write("\x1b[?2004l\x1b[<u\x1b[>4;0m\x1b[?25h");
  }
  drainInput(): Promise<void> {
    return Promise.resolve();
  }
  write(data: string): void {
    this.session.output.write(data);
  }
  get columns(): number {
    return this.session.output.columns ?? 80;
  }
  get rows(): number {
    return this.session.output.rows ?? 24;
  }
  moveBy(lines: number): void {
    this.write(`\x1b[${String(Math.abs(lines))}${lines < 0 ? "A" : "B"}`);
  }
  hideCursor(): void {
    this.write("\x1b[?25l");
  }
  showCursor(): void {
    this.write("\x1b[?25h");
  }
  clearLine(): void {
    this.write("\x1b[2K");
  }
  clearFromCursor(): void {
    this.write("\x1b[J");
  }
  clearScreen(): void {
    this.write("\x1b[2J\x1b[H");
  }
  setTitle(title: string): void {
    this.write(`\x1b]0;${title}\x07`);
  }
  setProgress(): void {
    /* No progress indicator while waiting for input. */
  }
}
