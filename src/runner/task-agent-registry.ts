import type { AcpAgentRegistry } from "acpx/runtime";

export function createTaskAgentRegistry(
  registry: AcpAgentRegistry,
  agent: string,
  environment?: Readonly<Record<string, string>>,
): AcpAgentRegistry {
  return {
    list: () => registry.list(),
    resolve: (agentName) => {
      const command = registry.resolve(agentName);
      if (agentName !== agent || environment === undefined) {
        return command;
      }
      if (!Array.isArray(command)) {
        throw new Error(
          `Agent "${agent}" must resolve to structured argv to configure its environment`,
        );
      }
      const assignments = Object.entries(environment).map(
        ([name, value]) => `${name}=${value}`,
      );
      return ["/usr/bin/env", ...assignments, ...command];
    },
  };
}
