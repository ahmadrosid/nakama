import { describe, expect, mock, test } from "bun:test";
import { createAnthropicProvider } from "./index";

const START =
  'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":10}}}\r\n\r\n';

const TOOL_USE = [
  START,
  'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"search_invoices","input":{}}}\r\n\r\n',
  'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":"}}\r\n\r\n',
  'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"invoice\\"}"}}\r\n\r\n',
  'event: content_block_stop\r\ndata:{"type":"content_block_stop","index":0}\r\n\r\n',
  'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\r\n\r\n',
];

const PAUSE_TURN = [
  START,
  'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_01","name":"web_search","input":{}}}\r\n\r\n',
  'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"nakama\\"}"}}\r\n\r\n',
  'event: content_block_stop\r\ndata:{"type":"content_block_stop","index":0}\r\n\r\n',
  'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"pause_turn"},"usage":{"output_tokens":5}}\r\n\r\n',
];

const PAUSE_TURN_NO_INPUT = [
  START,
  'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_02","name":"web_search","input":{}}}\r\n\r\n',
  'event: content_block_stop\r\ndata:{"type":"content_block_stop","index":0}\r\n\r\n',
  'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"pause_turn"},"usage":{"output_tokens":5}}\r\n\r\n',
];

const DONE = [
  START,
  'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
  'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\r\n\r\n',
  'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\r\n\r\n',
];

type CapturedBody = { messages: { content: unknown }[]; thinking?: unknown };

function eventStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
}

function providerCapturingBodies(
  streams: string[][],
  model = "claude-sonnet-4-6"
) {
  const responses = streams.map(eventStream);
  const bodies: CapturedBody[] = [];
  let call = 0;

  const fetchMock = mock(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const response = responses[call];
      call += 1;
      return response;
    }
  );

  const provider = createAnthropicProvider({
    apiKey: "sk-ant-test",
    fetch: fetchMock as unknown as typeof fetch,
    model,
  });

  return { bodies, provider };
}

function replayedBlocks(body: CapturedBody | undefined) {
  const assistant = body?.messages.find((message) =>
    Array.isArray(message.content)
  );

  return (assistant?.content ?? []) as { type: string; input?: unknown }[];
}

describe("Anthropic tool input replay", () => {
  test.each([false, true])(
    "preserves signed blocks through multiple pauses (stream=%s)",
    async (stream) => {
      const signed = {
        signature: "signed-pause",
        thinking: "Progress",
        type: "thinking",
      };
      const serverTool = {
        id: "srv-1",
        input: { query: "nakama" },
        name: "web_search",
        type: "server_tool_use",
      };
      const result = {
        content: [],
        tool_use_id: "srv-1",
        type: "web_search_tool_result",
      };
      const text = { text: "Done", type: "text" };
      const responses = [[signed, serverTool], [result], [text], [text]];
      const bodies: CapturedBody[] = [];
      const provider = createAnthropicProvider({
        apiKey: "test-key",
        fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
          bodies.push(JSON.parse(String(init?.body)));
          const blocks = responses[bodies.length - 1] ?? [];
          const stopReason = bodies.length < 3 ? "pause_turn" : "end_turn";
          if (stream && bodies.length < 4) {
            return eventStream([
              START,
              ...blocks.flatMap((block, index) => [
                `event: content_block_start\ndata: ${JSON.stringify({ content_block: block, index, type: "content_block_start" })}\n\n`,
                `event: content_block_stop\ndata: ${JSON.stringify({ index, type: "content_block_stop" })}\n\n`,
              ]),
              `event: message_delta\ndata: ${JSON.stringify({ delta: { stop_reason: stopReason }, type: "message_delta", usage: { output_tokens: 2 } })}\n\n`,
            ]);
          }
          return Response.json({
            content: blocks,
            stop_reason: stopReason,
            usage: { input_tokens: 10, output_tokens: 2 },
          });
        }) as typeof fetch,
        model: "claude-sonnet-5-5",
      });
      const input = {
        messages: [{ content: "Search", role: "user" as const }],
        providerOptions: { webSearch: true },
        system: "s",
      };
      const first = stream
        ? await provider.streamChat(input, { onChunk: () => undefined })
        : await provider.generateChat(input);
      expect(bodies[1]?.messages[1]?.content).toEqual([signed, serverTool]);
      expect(bodies[2]?.messages).toHaveLength(2);
      expect(bodies[2]?.messages[1]?.content).toEqual([
        signed,
        serverTool,
        result,
      ]);
      expect(first.content).toBe("Done");
      await provider.generateChat({
        ...input,
        messages: [
          ...input.messages,
          first.assistantMessage,
          { content: "Next", role: "user" },
        ],
      });
      expect(bodies[3]?.messages[1]?.content).toEqual([
        signed,
        serverTool,
        result,
        text,
      ]);
    }
  );

  test("replays streamed tool input on the next request", async () => {
    const { bodies, provider } = providerCapturingBodies([TOOL_USE, DONE]);

    const first = await provider.streamChat(
      { messages: [{ content: "find invoices", role: "user" }], system: "s" },
      { onChunk: () => undefined }
    );

    expect(first.toolCalls[0]?.arguments).toEqual({ query: "invoice" });

    await provider.streamChat(
      {
        messages: [
          { content: "find invoices", role: "user" },
          first.assistantMessage,
          {
            content: "[]",
            name: "search_invoices",
            role: "tool",
            toolCallId: "toolu_01",
          },
        ],
        system: "s",
      },
      { onChunk: () => undefined }
    );

    const toolUse = replayedBlocks(bodies[1]).find(
      (block) => block.type === "tool_use"
    );

    expect(toolUse?.input).toEqual({ query: "invoice" });
  });

  test("replays streamed server tool input on a pause_turn continuation", async () => {
    const { bodies, provider } = providerCapturingBodies(
      [PAUSE_TURN, DONE],
      "claude-sonnet-5-5"
    );

    await provider.streamChat(
      { messages: [{ content: "search the web", role: "user" }], system: "s" },
      { onChunk: () => undefined }
    );

    const serverToolUse = replayedBlocks(bodies[1]).find(
      (block) => block.type === "server_tool_use"
    );

    expect(serverToolUse?.input).toEqual({ query: "nakama" });
    expect(bodies[1]).toMatchObject({
      thinking: { type: "between_tools" },
    });
  });

  test("leaves a tool block alone when no input was streamed", async () => {
    const { bodies, provider } = providerCapturingBodies([
      PAUSE_TURN_NO_INPUT,
      DONE,
    ]);

    await provider.streamChat(
      { messages: [{ content: "search the web", role: "user" }], system: "s" },
      { onChunk: () => undefined }
    );

    const serverToolUse = replayedBlocks(bodies[1]).find(
      (block) => block.type === "server_tool_use"
    );

    expect(serverToolUse).toEqual({
      id: "srvtoolu_02",
      input: {},
      name: "web_search",
      type: "server_tool_use",
    });
  });
});
