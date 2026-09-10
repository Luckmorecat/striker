import type { AdapterRegistry } from "../core/adapter-registry.js";
import type { RunJournal } from "../core/contracts.js";
import { Dispatcher } from "../core/dispatcher.js";
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentRequest,
} from "../core/execution-environment.js";

export async function createExecutionDispatcher(options: {
  readonly adapters: AdapterRegistry;
  readonly environment: ExecutionEnvironment;
  readonly journal: RunJournal;
  readonly request: ExecutionEnvironmentRequest;
}): Promise<Dispatcher> {
  const services = await options.environment.open(options.request);
  return new Dispatcher({
    adapters: options.adapters,
    journal: options.journal,
    ...services,
  });
}
