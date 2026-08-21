import { describe, expect, it } from "vitest";

import {
  assertPermissionCapability,
  assertPreflightResult,
  harnessPreflightPrompt,
} from "./harness-preflight.js";

describe("harness preflight protocol", () => {
  it("requests only the configured installed skills", () => {
    const prompt = harnessPreflightPrompt(["security", "release"]);

    expect(prompt).toContain('["security","release"]');
    expect(prompt).not.toContain("striker-implementor");
    expect(prompt).toContain("Do not edit files or run commands");
  });

  it("accepts a result that names every configured skill", () => {
    expect(() => {
      assertPreflightResult(
        "codex",
        ["security"],
        'STRIKER_PREFLIGHT_RESULT {"available":["security"]}',
      );
    }).not.toThrow();
  });

  it("rejects a malformed result with the configured skill names", () => {
    expect(() => {
      assertPreflightResult("opencode", ["security"], "ready");
    }).toThrow('Harness "opencode" did not verify configured skills: security');
  });
});

describe("permission capability preflight", () => {
  it("accepts the runner-backed Codex auto-review capability", () => {
    expect(() => {
      assertPermissionCapability("codex", "auto-review");
    }).not.toThrow();
  });

  it("rejects auto-review for harnesses without an equivalent reviewer", () => {
    expect(() => {
      assertPermissionCapability("claude", "auto-review");
    }).toThrow(
      'Harness "claude" does not support permission mode "auto-review"',
    );
  });
});
