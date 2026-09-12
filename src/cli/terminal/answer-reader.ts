import { readFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AnswerReader } from "../answer-command.js";
import type { TerminalSession } from "./terminal-session.js";

/**
 * Answers that do not come from the terminal: a file, or piped input read to
 * EOF. The interactive answer belongs to the dashboard that shows the question.
 */
export function createAnswerReader(
  cwd: string,
  session: TerminalSession,
): AnswerReader {
  return {
    read: async (file) => {
      if (file !== undefined) return readFile(path.resolve(cwd, file), "utf8");
      const release = session.acquire();
      try {
        const decoder = new StringDecoder("utf8");
        let answer = "";
        for await (const chunk of session.input) {
          answer +=
            typeof chunk === "string" ? chunk : decoder.write(chunk as Buffer);
        }
        return answer + decoder.end();
      } finally {
        release();
      }
    },
  };
}
