import type { FeatureEnvironmentResources } from "../../core/environment-preparation.js";

export function containerRestrictions(
  resources: FeatureEnvironmentResources,
  user: string,
): string[] {
  return [
    "--pull=never",
    "--network=none",
    "--user",
    user,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--cpus",
    String(resources.cpus),
    "--memory",
    `${String(resources.memoryMiB)}m`,
    "--pids-limit",
    String(resources.pids),
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
  ];
}
