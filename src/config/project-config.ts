import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { agentHarnesses, type AgentHarness } from "../core/contracts.js";

export const projectConfigSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    harness: z.enum(agentHarnesses).optional(),
    image: z
      .string()
      .min(1)
      .regex(/^[^-\s][^\s]*$/)
      .optional(),
    skills: z.array(z.string().min(1)).optional(),
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
  readonly skills: readonly string[];
  readonly taskSource: "striker-plan";
}

export function parseProjectConfig(value: unknown): ProjectConfig {
  const parsed = projectConfigSchema.parse(value);
  return {
    ...(parsed.$schema === undefined ? {} : { $schema: parsed.$schema }),
    harness: parsed.harness ?? "codex",
    ...(parsed.image === undefined ? {} : { image: parsed.image }),
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
