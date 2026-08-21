import { spawn } from "node:child_process";

import type {
  VerificationRequest,
  VerificationResult,
  Verifier,
} from "../core/contracts.js";

export class ShellVerifier implements Verifier {
  verify(request: VerificationRequest): Promise<VerificationResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-lc", request.command], {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({
          command: request.command,
          exitCode: code ?? 1,
          output,
        });
      });
    });
  }
}
