import type { AdapterRegistry } from "../core/adapter-registry.js";
import type { RunJournal } from "../core/contracts.js";
import { Dispatcher } from "../core/dispatcher.js";
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentRequest,
  ExecutionServices,
} from "../core/execution-environment.js";

/** Display observation wraps composed ports; core keeps its own dependencies. */
export interface ExecutionObservers {
  journal(journal: RunJournal): RunJournal;
  services(services: ExecutionServices): ExecutionServices;
}

export async function createExecutionDispatcher(options: {
  readonly adapters: AdapterRegistry;
  readonly environment: ExecutionEnvironment;
  readonly journal: RunJournal;
  readonly observers?: ExecutionObservers;
  readonly request: ExecutionEnvironmentRequest;
}): Promise<Dispatcher> {
  const services = await options.environment.open(options.request);
  const observers = options.observers;
  return new Dispatcher({
    adapters: options.adapters,
    journal: observers ? observers.journal(options.journal) : options.journal,
    ...(observers ? observers.services(services) : services),
  });
}
