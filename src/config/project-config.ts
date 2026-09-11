import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { agentHarnesses, type AgentHarness } from "../core/contracts.js";

export const skillNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const projectConfigSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    harness: z.enum(agentHarnesses).optional(),
    image: z
      .string()
      .min(1)
      .regex(/^[^-\s][^\s]*$/)
      .optional(),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .optional(),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    skills: z
      .array(skillNameSchema)
      .refine(
        (names) => new Set(names).size === names.length,
        "Extra skill names must be unique",
      )
      .meta({ uniqueItems: true })
      .optional(),
    taskSource: z.literal("striker-plan"),
  })
  .strict()
  .meta({
    title: "Striker project configuration",
  });

export const projectConfigJsonSchema = z.toJSONSchema(projectConfigSchema, {
  target: "draft-2020-12",
});

export interface ProjectConfig {
  readonly $schema?: string;
  readonly harness: AgentHarness;
  readonly image?: string;
  readonly model?: string;
  readonly reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  readonly skills: readonly string[];
  readonly taskSource: "striker-plan";
}

export function parseProjectConfig(value: unknown): ProjectConfig {
  const parsed = projectConfigSchema.parse(value);
  return {
    ...(parsed.$schema === undefined ? {} : { $schema: parsed.$schema }),
    harness: parsed.harness ?? "codex",
    ...(parsed.image === undefined ? {} : { image: parsed.image }),
    ...(parsed.model === undefined ? {} : { model: parsed.model }),
    ...(parsed.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: parsed.reasoningEffort }),
    skills: parsed.skills ?? [],
    taskSource: parsed.taskSource,
  };
}

export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const filePath = path.join(root, "striker.config.json");
  try {
    return parseProjectConfig(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load striker.config.json: ${message}`, {
      cause: error,
    });
  }
}

export function resolveModelSelection(
  config: Pick<ProjectConfig, "model" | "reasoningEffort">,
) {
  return {
    model: config.model ?? "gpt-5.6-sol",
    effort: config.reasoningEffort ?? "low",
  };
}
