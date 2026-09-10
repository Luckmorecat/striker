import { readFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AnswerReader } from "../answer-command.js";
import { composeAnswer } from "./answer-composer.js";
import type { TerminalSession } from "./terminal-session.js";

export function createAnswerReader(
  cwd: string,
  session: TerminalSession,
): AnswerReader {
  return {
    read: async (file, context) => {
      if (file !== undefined) return readFile(path.resolve(cwd, file), "utf8");
      if (session.interactive) {
        if (context === undefined)
          throw new Error("Missing recovery context for interactive answer");
        return composeAnswer(session, context);
      }
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
