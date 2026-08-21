import { describe, expect, it } from "vitest";

import { transitionRun } from "./run-state.js";

describe("transitionRun", () => {
  it("moves a new run through execution to completion", () => {
    const running = transitionRun("created", "start");

    expect(running).toBe("running");
    expect(transitionRun(running, "complete_task")).toBe("running");
    expect(transitionRun(running, "complete")).toBe("completed");
  });

  it("resumes paused and failed runs through their distinct transitions", () => {
    expect(transitionRun("needs_attention", "answer")).toBe("running");
    expect(transitionRun("needs_attention", "resume")).toBe("running");
    expect(transitionRun("failed", "retry")).toBe("running");
  });

  it("rejects transitions that the state machine does not define", () => {
    expect(() => transitionRun("completed", "resume")).toThrow(
      "Illegal run transition: completed -> resume",
    );
  });
});
