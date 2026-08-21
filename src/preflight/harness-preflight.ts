import type { AgentHarness } from "../core/contracts.js";

const resultPrefix = "STRIKER_PREFLIGHT_RESULT ";

interface PreflightResult {
  readonly available: readonly string[];
}

export function harnessPreflightPrompt(skills: readonly string[]): string {
  return [
    "# Striker harness preflight",
    "",
    "This is a read-only availability check. Do not edit files or run commands.",
    "Resolve and read the entrypoint for each configured installed skill below.",
    "Do not apply the skills' instructions during this check.",
    `Configured skills: ${JSON.stringify(skills)}`,
    "",
    "Reply on the final line with this prefix followed by JSON.",
    `${resultPrefix}{"available":["each skill you loaded"]}`,
    "Omit any skill that is unavailable.",
  ].join("\n");
}

function parsePreflightResult(output: string): PreflightResult | null {
  const line = output
    .split("\n")
    .findLast((candidate) => candidate.startsWith(resultPrefix));
  if (line === undefined) return null;
  try {
    const value = JSON.parse(line.slice(resultPrefix.length)) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("available" in value)
    ) {
      return null;
    }
    const available = (value as { readonly available: unknown }).available;
    if (
      !Array.isArray(available) ||
      !available.every((item) => typeof item === "string")
    ) {
      return null;
    }
    return { available };
  } catch {
    return null;
  }
}

export function assertPreflightResult(
  harness: AgentHarness,
  skills: readonly string[],
  output: string,
): void {
  const result = parsePreflightResult(output);
  if (result === null) {
    const names = skills.length === 0 ? "none" : skills.join(", ");
    throw new Error(
      `Harness "${harness}" did not verify configured skills: ${names}`,
    );
  }
  const missing = skills.find((skill) => !result.available.includes(skill));
  if (missing !== undefined) {
    throw new Error(
      `Configured skill "${missing}" is unavailable in harness "${harness}"`,
    );
  }
}
