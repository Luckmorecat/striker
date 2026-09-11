import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

interface ModelRequest {
  input: unknown[];
  tools?: {
    name?: string;
    type: string;
    parameters?: { properties?: Record<string, unknown> };
  }[];
}
function send(response: ServerResponse, output: Record<string, unknown>) {
  const id = `resp_${randomUUID()}`;
  const result = {
    id,
    object: "response",
    status: "completed",
    output: [output],
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      total_tokens: 20,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  response.writeHead(200, { "content-type": "text/event-stream" });
  let sequence = 0;
  const event = (type: string, value: Record<string, unknown>) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...value })}\n\n`,
    );
  event("response.created", {
    response: { ...result, status: "in_progress", output: [] },
  });
  event("response.output_item.added", { output_index: 0, item: output });
  if (output.type === "function_call") {
    event("response.function_call_arguments.delta", {
      item_id: output.id,
      output_index: 0,
      delta: output.arguments,
    });
    event("response.function_call_arguments.done", {
      item_id: output.id,
      output_index: 0,
      arguments: output.arguments,
    });
  } else if (output.type === "custom_tool_call") {
    event("response.custom_tool_call_input.delta", {
      item_id: output.id,
      output_index: 0,
      delta: output.input,
    });
    event("response.custom_tool_call_input.done", {
      item_id: output.id,
      output_index: 0,
      input: output.input,
    });
  } else {
    const content = output.content as { text: string }[];
    event("response.content_part.added", {
      item_id: output.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    event("response.output_text.delta", {
      item_id: output.id,
      output_index: 0,
      content_index: 0,
      delta: content[0]?.text,
    });
    event("response.output_text.done", {
      item_id: output.id,
      output_index: 0,
      content_index: 0,
      text: content[0]?.text,
    });
  }
  event("response.output_item.done", { output_index: 0, item: output });
  event("response.completed", { response: result });
  response.end();
}
function textOutput(value: unknown) {
  return {
    type: "message",
    id: `msg_${randomUUID()}`,
    role: "assistant",
    status: "completed",
    content: [
      { type: "output_text", text: JSON.stringify(value), annotations: [] },
    ],
  };
}
function reviewOutput(text: string) {
  const decoded = text.replaceAll('\\"', '"');
  const startCommit = /"startCommit":\s*"([a-f0-9]{40})"/.exec(decoded)?.[1];
  const resultCommit = /"resultCommit":\s*"([a-f0-9]{40})"/.exec(decoded)?.[1];
  if (!startCommit || !resultCommit)
    throw new Error("Missing review candidate");
  const kind = text.includes("# Independent standards review")
    ? "standards"
    : "plan_compliance";
  return textOutput({
    kind,
    startCommit,
    resultCommit,
    verdict: "passed",
    findings: [],
    ...(kind === "plan_compliance"
      ? { discoveryDecisions: [], outcomeFactDecisions: [] }
      : {}),
  });
}
function modelOutput(body: ModelRequest) {
  const text = JSON.stringify(body.input);
  const review =
    text.includes("# Independent standards review") ||
    text.includes("# Independent plan-compliance review");
  if (review) {
    return reviewOutput(text);
  }
  if (
    body.input.some((item) =>
      ["function_call_output", "custom_tool_call_output"].includes(
        (item as { type: string }).type,
      ),
    )
  )
    return textOutput({
      kind: "implementation",
      summary: "Implemented and committed task",
      discoveries: [],
      outcomeFacts: [],
    });
  const second = text.includes("SLICE_TEST_TASK_2");
  const command = second
    ? "test $(cat first.txt) = first && printf second > second.txt && git add second.txt && git commit -m second"
    : "printf first > first.txt && git add first.txt && git commit -m first";
  if (
    body.input.some(
      (item) => (item as { type: string }).type === "additional_tools",
    )
  ) {
    return {
      type: "custom_tool_call",
      id: `ctc_${randomUUID()}`,
      call_id: `call_${randomUUID()}`,
      name: "exec",
      namespace: "functions",
      input: `text(await tools.exec_command(${JSON.stringify({ cmd: command })}));`,
      status: "completed",
    };
  }
  const tool = (body.tools ?? []).find(
    (tool) => tool.name === "exec_command" || tool.name === "bash",
  );
  if (!tool?.name)
    throw new Error(
      `No supported terminal tool: ${(body.tools ?? []).map((tool) => tool.name ?? tool.type).join(",")}`,
    );
  return {
    type: "function_call",
    id: `fc_${randomUUID()}`,
    call_id: `call_${randomUUID()}`,
    name: tool.name,
    arguments: JSON.stringify({
      [tool.name === "bash" ? "command" : "cmd"]: command,
    }),
    status: "completed",
  };
}
export async function fakeResponses() {
  const errors: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.from(chunk as Buffer));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as ModelRequest;
      send(response, modelOutput(body));
    })().catch((error: unknown) => {
      errors.push(String(error));
      response.writeHead(500).end("Fake model failure");
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fake endpoint");
  return {
    url: `http://127.0.0.1:${String(address.port)}/v1/responses`,
    errors,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
