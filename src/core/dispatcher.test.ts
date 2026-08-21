import { describe, expect, it } from "vitest";

import { AdapterRegistry, Dispatcher } from "../index.js";
import {
  FakeAgentRunner,
  InMemoryRunJournal,
  InMemoryTaskSourceAdapter,
} from "../testing/fakes.js";

const task = {
  identity: { id: "slice-01", revision: "rev-1" },
  title: "Bootstrap the dispatch core",
  instructions: "Implement slice 01.",
} as const;

function registryWithEvidence(summary?: string): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    new InMemoryTaskSourceAdapter(
      "memory",
      [task],
      summary === undefined ? {} : { "slice-01": { summary } },
    ),
  );
  return registry;
}

describe("Dispatcher", () => {
  it("dispatches one task and returns source-backed completion evidence", async () => {
    const evidence = { summary: "slice 01 is complete" } as const;
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(evidence.summary),
      journal,
      runner: new FakeAgentRunner({
        output: "Implementation finished.",
        session: { id: "session-1" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-1",
      skills: ["next-slice"],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result).toEqual({
      evidence,
      runId: "run-1",
      session: { id: "session-1" },
      status: "completed",
      task,
    });
    expect(journal.deletedRunIds).toEqual(["run-1"]);
  });

  it("needs attention when the source has no completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence(),
      journal,
      runner: new FakeAgentRunner({
        output: "This output is not completion proof.",
        session: { id: "session-2" },
        status: "returned",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-2",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("needs_attention");
    expect(journal.snapshots.at(-1)?.status).toBe("needs_attention");
    expect(journal.deletedRunIds).toEqual([]);
  });

  it("persists a failed agent turn without accepting completion evidence", async () => {
    const journal = new InMemoryRunJournal();
    const dispatcher = new Dispatcher({
      adapters: registryWithEvidence("would otherwise complete"),
      journal,
      runner: new FakeAgentRunner({
        error: "agent process exited",
        session: { id: "session-3" },
        status: "failed",
      }),
    });

    const result = await dispatcher.dispatchOne({
      completedTasks: [],
      runId: "run-3",
      skills: [],
      taskSource: { location: "memory://plan", type: "memory" },
    });

    expect(result.status).toBe("failed");
    expect(journal.snapshots.at(-1)?.status).toBe("failed");
    expect(journal.deletedRunIds).toEqual([]);
  });
});
