import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ShellVerifier } from "./shell-verifier.js";

describe("shell verifier", () => {
  it("runs the exact command once through the requested Git root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "striker-shell-"));

    const result = await new ShellVerifier().verify({
      command: "pwd; printf 'out'; printf 'err' >&2; exit 7",
      cwd: root,
    });

    expect(result).toEqual({
      command: "pwd; printf 'out'; printf 'err' >&2; exit 7",
      exitCode: 7,
      output: `${await realpath(root)}\nouterr`,
    });
  });
});
