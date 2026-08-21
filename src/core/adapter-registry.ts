import type { TaskSourceAdapter } from "./contracts.js";

export class AdapterRegistry {
  readonly #adapters = new Map<string, TaskSourceAdapter>();

  register(adapter: TaskSourceAdapter): void {
    if (this.#adapters.has(adapter.type)) {
      throw new Error(
        `Task source adapter is already registered: ${adapter.type}`,
      );
    }

    this.#adapters.set(adapter.type, adapter);
  }

  get(type: string): TaskSourceAdapter {
    const adapter = this.#adapters.get(type);

    if (adapter === undefined) {
      throw new Error(`Task source adapter is not registered: ${type}`);
    }

    return adapter;
  }
}
