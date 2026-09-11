import { describe, expect, it } from "vitest";

import type { RunObservation } from "../../core/run-observation.js";
import { createRunObservations, observedVerifier } from "./progress-events.js";

function collector() {
  const observations: RunObservation[] = [];
  return {
    observations,
    observer: {
      observe: (o: RunObservation) => {
        observations.push(o);
      },
    },
  };
}

const preparing: RunObservation = {
  detail: "Opening the retained workspace.",
  kind: "preparation",
  phase: "started",
};

describe("createRunObservations", () => {
  it("delivers an observation to every subscriber", () => {
    const first = collector();
    const second = collector();
    const publisher = createRunObservations();
    publisher.subscribe(first.observer);
    publisher.subscribe(second.observer);

    publisher.observe(preparing);

    expect(first.observations).toEqual([preparing]);
    expect(second.observations).toEqual([preparing]);
  });

  it("stops delivering to a disposed subscription", () => {
    const { observations, observer } = collector();
    const publisher = createRunObservations();
    const dispose = publisher.subscribe(observer);

    dispose();
    publisher.observe(preparing);

    expect(observations).toEqual([]);
  });

  it("drops every subscription when the command closes", () => {
    const { observations, observer } = collector();
    const publisher = createRunObservations();
    publisher.subscribe(observer);

    publisher.close();
    publisher.observe(preparing);

    expect(observations).toEqual([]);
  });

  it("keeps publishing when one observer throws", () => {
    const { observations, observer } = collector();
    const publisher = createRunObservations();
    publisher.subscribe({
      observe: () => {
        throw new Error("renderer crashed");
      },
    });
    publisher.subscribe(observer);

    expect(() => {
      publisher.observe(preparing);
    }).not.toThrow();
    expect(observations).toEqual([preparing]);
  });
});

describe("observedVerifier", () => {
  it("reports verification in flight and its exit code", async () => {
    const { observations, observer } = collector();
    const verifier = observedVerifier(
      {
        verify: () => {
          expect(observations).toEqual([
            { command: "pnpm check", kind: "verification", phase: "started" },
          ]);
          return Promise.resolve({
            command: "pnpm check",
            exitCode: 0,
            output: "ok",
          });
        },
      },
      observer,
    );

    await verifier.verify({ command: "pnpm check", cwd: "/repo" });

    expect(observations).toEqual([
      { command: "pnpm check", kind: "verification", phase: "started" },
      {
        command: "pnpm check",
        exitCode: 0,
        kind: "verification",
        phase: "finished",
      },
    ]);
  });

  it("reports a finished verification when the verifier fails", async () => {
    const { observations, observer } = collector();
    const failure = new Error("verifier crashed");
    const verifier = observedVerifier(
      { verify: () => Promise.reject(failure) },
      observer,
    );

    await expect(
      verifier.verify({ command: "pnpm check", cwd: "/repo" }),
    ).rejects.toBe(failure);
    expect(observations.at(-1)).toEqual({
      command: "pnpm check",
      kind: "verification",
      phase: "finished",
    });
  });
});
