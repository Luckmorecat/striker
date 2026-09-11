import { dockerCommand } from "./docker-command.js";

export function executionLifetime(broker: { close(): Promise<void> }) {
  let environmentId: string | undefined;
  let connectivity: { close(): Promise<void> } | undefined;
  return {
    environment(id: string) {
      environmentId = id;
    },
    connectivity(value: { close(): Promise<void> }) {
      connectivity = value;
    },
    async close() {
      try {
        if (environmentId)
          await dockerCommand(["stop", "--time", "0", environmentId]);
      } finally {
        try {
          await connectivity?.close();
        } finally {
          await broker.close();
        }
      }
    },
  };
}
