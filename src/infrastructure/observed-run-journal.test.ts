import { describe, expect, it } from "vitest";

import type { RunJournal, RunJournalEvent } from "../core/contracts.js";
import type { RunObservation } from "../core/run-observation.js";
import { observedRunJournal } from "./observed-run-journal.js";

const started: RunJournalEvent = {
  planId: "plan",
  request: {
    completedTasks: [],
    planId: "plan",
    runId: "run",
    skills: [],
    taskSource: { location: "/plan", type: "striker" },
  },
  runId: "run",
  type: "run_started",
};

function recordingJournal(append: (event: RunJournalEvent) => Promise<void>) {
  const appended: RunJournalEvent[] = [];
  const journal: RunJournal = {
    append: async (event) => {
      appended.push(event);
      await append(event);
    },
    load: () => Promise.resolve(null),
    loadActive: () => Promise.resolve(null),
  };
  return { appended, journal };
}

describe("observedRunJournal", () => {
  it("publishes a journal observation only after the append resolves", async () => {
    const order: string[] = [];
    const { journal } = recordingJournal(() => {
      order.push("persisted");
      return Promise.resolve();
    });
    const observed = observedRunJournal(journal, {
      observe: (observation) => {
        order.push(`observed:${observation.kind}`);
      },
    });

    await observed.append(started);

    expect(order).toEqual(["persisted", "observed:journal"]);
  });

  it("carries the persisted event to the observer", async () => {
    const observations: RunObservation[] = [];
    const { journal } = recordingJournal(() => Promise.resolve());
    const observed = observedRunJournal(journal, {
      observe: (observation) => observations.push(observation),
    });

    await observed.append(started);

    expect(observations).toEqual([{ event: started, kind: "journal" }]);
  });

  it("publishes nothing and preserves the error when the append fails", async () => {
    const observations: RunObservation[] = [];
    const failure = new Error("disk full");
    const { journal } = recordingJournal(() => Promise.reject(failure));
    const observed = observedRunJournal(journal, {
      observe: (observation) => observations.push(observation),
    });

    await expect(observed.append(started)).rejects.toBe(failure);
    expect(observations).toEqual([]);
  });

  it("keeps a persisted append successful when the observer throws", async () => {
    const { appended, journal } = recordingJournal(() => Promise.resolve());
    const observed = observedRunJournal(journal, {
      observe: () => {
        throw new Error("renderer crashed");
      },
    });

    await expect(observed.append(started)).resolves.toBeUndefined();
    expect(appended).toEqual([started]);
  });

  it("delegates reads to the wrapped journal", async () => {
    const recovery = {
      completedTasks: [],
      lastEvent: started,
      planId: "plan",
      snapshot: null,
      taskOutcomes: [],
    };
    const journal: RunJournal = {
      append: () => Promise.resolve(),
      load: () => Promise.resolve(recovery),
      loadActive: () => Promise.resolve(recovery),
    };
    const observed = observedRunJournal(journal, { observe: () => undefined });

    await expect(observed.load("plan")).resolves.toBe(recovery);
    await expect(observed.loadActive()).resolves.toBe(recovery);
  });
});
