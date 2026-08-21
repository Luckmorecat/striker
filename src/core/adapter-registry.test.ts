import { describe, expect, it } from "vitest";

import { AdapterRegistry, type TaskSourceAdapter } from "../index.js";

const memoryAdapter: TaskSourceAdapter = {
  type: "memory",
  open() {
    return Promise.reject(new Error("not needed by this registry test"));
  },
};

describe("AdapterRegistry", () => {
  it("returns an adapter registered by its task source type", () => {
    const registry = new AdapterRegistry();

    registry.register(memoryAdapter);

    expect(registry.get("memory")).toBe(memoryAdapter);
  });

  it("rejects two adapters for the same task source type", () => {
    const registry = new AdapterRegistry();
    registry.register(memoryAdapter);

    expect(() => {
      registry.register(memoryAdapter);
    }).toThrow("Task source adapter is already registered: memory");
  });

  it("rejects an unregistered task source type", () => {
    const registry = new AdapterRegistry();

    expect(() => registry.get("missing")).toThrow(
      "Task source adapter is not registered: missing",
    );
  });
});
