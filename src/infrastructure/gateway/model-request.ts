import { z } from "zod";

const tool = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("function"),
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()),
      strict: z.boolean().nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("custom"),
      name: z.string(),
      description: z.string().optional(),
      format: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["web_search", "web_search_preview"]),
      search_context_size: z.string().optional(),
      filters: z.unknown().optional(),
      user_location: z.unknown().optional(),
    })
    .strict(),
]);
const schema = z
  .object({
    model: z.string(),
    input: z.union([z.string(), z.array(z.unknown())]),
    instructions: z.string().optional(),
    tools: z.array(tool).optional(),
    tool_choice: z.unknown().optional(),
    parallel_tool_calls: z.boolean().optional(),
    stream: z.boolean().optional(),
    store: z.boolean().optional(),
    reasoning: z.unknown().optional(),
    text: z.unknown().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    client_metadata: z.record(z.string(), z.string()).optional(),
    include: z.array(z.string()).optional(),
    prompt_cache_key: z.string().optional(),
  })
  .strict();

export function modelRequest(
  value: unknown,
  model: string,
  effort: string,
): Record<string, unknown> | undefined {
  const result = schema.safeParse(value);
  if (!result.success || result.data.model !== model) return undefined;
  return { ...result.data, reasoning: { effort }, store: false };
}
