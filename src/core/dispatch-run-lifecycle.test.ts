import { describe, expect, it } from "vitest";

import { InMemoryRunJournal } from "../testing/fakes.js";
import type { DispatchRequest } from "./contracts.js";
import { ensureRunStarted } from "./dispatch-run-lifecycle.js";

function request(planId: string): DispatchRequest {
  return {
    completedTasks: [],
    planId,
    runId: "shared-run",
    skills: [],
    taskSource: { location: "memory://plan", type: "memory" },
  };
}

describe("run lifecycle identity", () => {
  it("rejects an active run reused for another plan", async () => {
    const journal = new InMemoryRunJournal();
    await ensureRunStarted(journal, request("plan-a"));

    await expect(ensureRunStarted(journal, request("plan-b"))).rejects.toThrow(
      "Another Striker run is active",
    );
  });
});
