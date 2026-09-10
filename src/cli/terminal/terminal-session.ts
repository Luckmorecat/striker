import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export interface TerminalInput extends Readable {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(raw: boolean): unknown;
}
export interface TerminalOutput extends Writable {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
}

/** One owner per terminal, shared by answer and permission prompts. */
export class TerminalSession {
  private owned = false;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  constructor(
    readonly input: TerminalInput,
    readonly output: TerminalOutput,
  ) {}

  get interactive(): boolean {
    return (
      this.enabled && this.input.isTTY === true && this.output.isTTY === true
    );
  }

  acquire(): () => void {
    if (this.owned) throw new Error("Terminal input is already in use");
    if (this.interactive) {
      while (this.input.read() !== null) {
        // Keys buffered before this prompt belong to its previous owner.
      }
    }
    this.owned = true;
    return () => {
      this.owned = false;
    };
  }

  async permission(
    raw: unknown,
  ): Promise<{ outcome: "allow_once" | "reject_once" }> {
    if (!this.interactive) return { outcome: "reject_once" };
    const wasFlowing = this.input.readableFlowing === true;
    const release = this.acquire();
    const prompt = createInterface({
      input: this.input,
      output: this.output,
      terminal: false,
    });
    try {
      const answer = await prompt.question(
        `Codex requests permission: ${JSON.stringify(raw)}\nAllow once? [y/N] `,
      );
      return {
        outcome:
          answer.trim().toLowerCase() === "y" ? "allow_once" : "reject_once",
      };
    } finally {
      prompt.close();
      if (!wasFlowing) this.input.pause();
      release();
    }
  }
}
