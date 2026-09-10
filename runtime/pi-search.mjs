import { Type } from "@earendil-works/pi-ai";
import process from "node:process";
export default function (pi) {
  pi.registerTool({
    name: "striker_search",
    label: "Subscription search",
    description:
      "Search the public web through the subscription broker and return cited sources.",
    parameters: Type.Object({ query: Type.String() }),
    async execute(_id, params, signal) {
      const response = await globalThis.fetch(
        `${process.env.STRIKER_GATEWAY_URL}/v1/search`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.STRIKER_RUN_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(params),
          signal,
        },
      );
      if (!response.ok) throw new Error("Subscription search failed");
      return {
        content: [
          { type: "text", text: JSON.stringify(await response.json()) },
        ],
        details: {},
      };
    },
  });
}
