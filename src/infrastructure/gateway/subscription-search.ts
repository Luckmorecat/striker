import { z } from "zod";

const querySchema = z.object({ query: z.string().min(1).max(4000) }).strict();
const citation = z.object({
  type: z.literal("url_citation"),
  url: z.url(),
  title: z.string(),
});
const message = z.object({
  type: z.literal("message"),
  content: z.array(
    z.object({
      type: z.literal("output_text"),
      text: z.string(),
      annotations: z.array(z.unknown()),
    }),
  ),
});
const completed = z.object({
  type: z.literal("response.completed"),
  response: z.object({ output: z.array(z.unknown()) }),
});

export function searchRequest(
  value: unknown,
  model: string,
  effort: string,
): Record<string, unknown> | undefined {
  const query = querySchema.safeParse(value);
  if (!query.success) return undefined;
  return {
    model,
    reasoning: { effort },
    input: [{ role: "user", content: query.data.query }],
    instructions: "Search the public web. Answer with source citations.",
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    stream: true,
    store: false,
  };
}

export async function searchResult(response: Response) {
  const text = await boundedText(response);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const event = completed.safeParse(JSON.parse(line.slice(6)));
    if (event.success) return citedResult(event.data.response.output);
  }
  throw new Error("Subscription search did not complete");
}

function citedResult(output: unknown[]) {
  const searched = output.some(
    (item) =>
      z
        .object({
          type: z.literal("web_search_call"),
          status: z.literal("completed"),
        })
        .safeParse(item).success,
  );
  const parts = output.flatMap((item) => {
    const parsed = message.safeParse(item);
    return parsed.success ? parsed.data.content : [];
  });
  const sources = parts.flatMap((part) =>
    part.annotations.flatMap((item) => {
      const parsed = citation.safeParse(item);
      if (!parsed.success || !/^https?:\/\//.test(parsed.data.url)) return [];
      return [{ url: parsed.data.url, title: parsed.data.title }];
    }),
  );
  if (!searched || sources.length === 0)
    throw new Error(
      "Subscription search returned no verified search citations",
    );
  return { text: parts.map((part) => part.text).join("\n"), sources };
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing search response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Search response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}
