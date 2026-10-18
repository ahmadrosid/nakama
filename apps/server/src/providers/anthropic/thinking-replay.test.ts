import { describe, expect, test } from "bun:test";
import type { ChatMessage, GenerateChatInput } from "@nakama/core";
import { asTestFetch } from "../test-helpers";
import { createAnthropicProvider, parseAnthropicContent } from "./index";

type CapturedAnthropicRequest = {
  max_tokens?: number;
  messages: Array<{ content: string | unknown[]; role: string }>;
  model?: string;
  output_config?: { effort?: string };
  system?: string;
  thinking?: {
    block_binding?: { prefix_mismatch_behavior?: string };
    display?: string;
    type?: string;
  };
  tools?: unknown[];
};

test.each([false, true])(
  "Sonnet 5.5 wire replay survives persistence, not edits (stream=%s)",
  async (stream) => {
    const requests: Array<{
      messages: Array<{ role: string; content: unknown[] }>;
    }> = [];

    const signed = {
      signature: "signed-progress",
      thinking: "Progress",
      type: "thinking",
    };

    const redacted = { data: "opaque", type: "redacted_thinking" };

    const tool = {
      id: "lookup-1",
      input: { query: "alpha" },
      name: "lookup",
      type: "tool_use",
    };

    const blocks = [{ text: "Before", type: "text" }, signed, redacted, tool];

    const provider = createAnthropicProvider({
      apiKey: "test-key",
      fetch: asTestFetch(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
          requests.push(JSON.parse(String(init?.body)));

          if (stream) {
            const events = [
              {
                message: { usage: { input_tokens: 3, output_tokens: 0 } },
                type: "message_start",
              },
              ...blocks.flatMap((block, index) =>
                block.type === "thinking"
                  ? [
                      {
                        content_block: {
                          signature: "",
                          thinking: "",
                          type: "thinking",
                        },
                        index,
                        type: "content_block_start",
                      },
                      {
                        delta: { thinking: "Progress", type: "thinking_delta" },
                        index,
                        type: "content_block_delta",
                      },
                      {
                        delta: {
                          signature: "signed-progress",
                          type: "signature_delta",
                        },
                        index,
                        type: "content_block_delta",
                      },
                      { index, type: "content_block_stop" },
                    ]
                  : [
                      {
                        content_block: block,
                        index,
                        type: "content_block_start",
                      },
                      { index, type: "content_block_stop" },
                    ]
              ),
              {
                delta: { stop_reason: "tool_use" },
                type: "message_delta",
                usage: { output_tokens: 2 },
              },
              { type: "message_stop" },
            ];

            return new Response(
              events
                .map(
                  (event) =>
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
                )
                .join(""),
              { headers: { "Content-Type": "text/event-stream" } }
            );
          }

          return Response.json({
            content: blocks,
            stop_reason: "tool_use",
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        }
      ),
      model: "claude-sonnet-5-5",
    });

    const thinkingChunks: string[] = [];

    const run = (input: GenerateChatInput) =>
      stream
        ? provider.streamChat(input, {
            onChunk: () => undefined,
            onThinking: (chunk) => thinkingChunks.push(chunk),
          })
        : provider.generateChat(input);

    const user: ChatMessage = JSON.parse('{"role":"user","content":"First"}');

    const tools = [
      {
        description: "Lookup",
        name: "lookup",
        parameters: { properties: {}, type: "object" },
      },
    ];

    const first = await run({ messages: [user], system: "s", tools });

    if (stream) {
      expect(thinkingChunks.join("")).toBe("Progress");
    }

    // DB reconstruction can reorder properties and add non-wire fields.
    const persisted: Extract<ChatMessage, { role: "assistant" }> = JSON.parse(
      JSON.stringify({
        ...first.assistantMessage,
        content: "UI text",
        thinking: "UI summary",
      })
    );

    const history: ChatMessage[] = [
      { content: "First", role: "user" },
      persisted,
      {
        content: "found",
        name: "lookup",
        role: "tool",
        toolCallId: "lookup-1",
      },
    ];

    await run({ messages: history, system: "s", tools });
    expect(requests.at(-1)?.messages[1]?.content).toEqual(blocks);
    // A later signed turn must use the normalized prefix, too.
    const second = await run({ messages: history, system: "s", tools });

    const longer: ChatMessage[] = [
      ...history,
      second.assistantMessage,
      {
        content: "again",
        name: "lookup",
        role: "tool",
        toolCallId: "lookup-1",
      },
    ];

    await run({ messages: longer, system: "s", tools });
    expect(requests.at(-1)?.messages[3]?.content).toEqual(blocks);

    const editedUserMessage: ChatMessage = { content: "Edited", role: "user" };

    const compactedUserMessage: ChatMessage = {
      content: "Compacted summary",
      role: "user",
    };

    for (const messages of [
      [editedUserMessage, ...history.slice(1)],
      [compactedUserMessage, ...history.slice(1)],
      [
        history[0]!,
        {
          ...persisted,
          providerContent: [
            { text: "Edited before thinking", type: "text" },
            ...persisted.providerContent!.slice(1),
          ],
        },
        history[2]!,
      ],
    ]) {
      await run({ messages, system: "s", tools });
      expect(requests.at(-1)?.messages[1]?.content).toHaveLength(2);
      expect(JSON.stringify(requests.at(-1))).not.toContain("signed-progress");
      expect(JSON.stringify(requests.at(-1))).not.toContain("opaque");
      expect(requests.at(-1)?.messages[1]?.content.at(-1)).toEqual(tool);
    }

    // Untracked imported blocks are not safe to replay in between_tools mode.
    await run({
      messages: [
        user,
        { content: "", providerContent: [signed, redacted], role: "assistant" },
        { content: "Next", role: "user" },
      ],
      system: "s",
    });
    expect(requests.at(-1)?.messages).toHaveLength(2);
  }
);

test("Sonnet 5.5 adaptive effort and mode switches", async () => {
  for (const effort of ["low", "medium", "high"] as const) {
    const requests: Array<{
      messages: Array<{ content: unknown[] }>;
      thinking?: unknown;
      output_config?: unknown;
    }> = [];

    const signed = {
      signature: "signature",
      thinking: "Progress",
      type: "thinking",
    };

    const text = { text: "Answer", type: "text" };

    const provider = createAnthropicProvider({
      apiKey: "test-key",
      fetch: asTestFetch(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
          requests.push(JSON.parse(String(init?.body)));

          return Response.json({
            content: [signed, text],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        }
      ),
      model: "claude-sonnet-5-5",
    });

    const user: ChatMessage = { content: "First", role: "user" };

    const first = await provider.generateChat({
      messages: [user],
      providerOptions: { thinking: { effort, enabled: true } },
      system: "s",
    });

    expect(requests[0]?.output_config).toEqual({ effort });

    const history: ChatMessage[] = [
      user,
      first.assistantMessage,
      { content: "Next", role: "user" },
    ];

    await provider.generateChat({
      messages: history,
      providerOptions: { thinking: { effort: "high", enabled: true } },
      system: "edited",
    });
    expect(requests.at(-1)?.thinking).toEqual({
      block_binding: { prefix_mismatch_behavior: "drop_block" },
      display: "summarized",
      type: "adaptive",
    });
    expect(requests.at(-1)?.messages[1]?.content).toEqual([signed, text]);

    const off = await provider.generateChat({
      messages: history,
      providerOptions: { thinking: { effort, enabled: false } },
      system: "s",
    });

    expect(requests.at(-1)?.thinking).toEqual({ type: "between_tools" });
    expect(requests.at(-1)?.output_config).toBeUndefined();
    expect(requests.at(-1)?.messages[1]?.content).toEqual([text]);
    await provider.generateChat({
      messages: [
        ...history,
        off.assistantMessage,
        { content: "Again", role: "user" },
      ],
      providerOptions: { thinking: { effort: "low", enabled: false } },
      system: "s",
    });
    expect(requests.at(-1)?.output_config).toBeUndefined();
    expect(requests.at(-1)?.messages[3]?.content).toEqual([signed, text]);
    await provider.generateChat({
      messages: [...history, off.assistantMessage],
      providerOptions: { thinking: { effort, enabled: true } },
      system: "s",
    });
    expect(requests.at(-1)?.thinking).toMatchObject({
      block_binding: { prefix_mismatch_behavior: "drop_block" },
      type: "adaptive",
    });
  }
});

test("Opus 5.5 replays signed thinking when the system prefix changes", async () => {
  const requests: CapturedAnthropicRequest[] = [];

  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: asTestFetch(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("anthropic-beta")).toBe(
          "thinking-binding-controls-2026-08-01"
        );
        requests.push(JSON.parse(String(init?.body)));

        return Response.json({
          content: [{ text: "Done.", type: "text" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 2 },
        });
      }
    ),
    model: "claude-opus-5-5",
  });

  const prior = {
    content: "First answer",
    providerContent: [
      { signature: "signed-block", thinking: "Private plan", type: "thinking" },
      { text: "First answer", type: "text" },
    ],
    role: "assistant" as const,
  };

  await provider.generateChat({
    messages: [{ content: "First", role: "user" }, prior],
    system: "Original prompt",
  });
  await provider.generateChat({
    messages: [
      { content: "First", role: "user" },
      prior,
      { content: "Next", role: "user" },
    ],
    system: "Updated prompt",
  });

  expect(requests[0]?.system).toBe("Original prompt");
  expect(requests[1]?.system).toBe("Updated prompt");
  expect(requests[1]?.messages[1]?.content).toEqual(prior.providerContent);
  expect(requests[1]?.thinking).toEqual({
    block_binding: { prefix_mismatch_behavior: "drop_block" },
    type: "adaptive",
  });
});

describe("parseAnthropicContent", () => {
  test("keeps thinking out of assistant content", () => {
    const result = parseAnthropicContent([
      {
        signature: "signed-plan",
        thinking: "Plan the answer.",
        type: "thinking",
      },
      { citations: null, text: "Hello.", type: "text" },
    ]);

    expect(result.content).toBe("Hello.");
    expect(result.assistantMessage.thinking).toBe("Plan the answer.");
  });
});
