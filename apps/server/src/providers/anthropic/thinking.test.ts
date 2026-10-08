import { describe, expect, test } from "bun:test";
import type { ChatMessage, GenerateChatInput } from "@nakama/core";
import { createAnthropicProvider, parseAnthropicContent } from "./index";

describe("Anthropic thinking requests", () => {
  test.each([
    [
      "claude-sonnet-5",
      true,
      { display: "summarized", type: "adaptive" },
      { effort: "low" },
    ],
    ["claude-sonnet-4-6", true, { type: "adaptive" }, { effort: "low" }],
    ["claude-sonnet-5", false, { type: "disabled" }, undefined],
    ["claude-sonnet-5-5", false, { type: "between_tools" }, undefined],
    [
      "claude-sonnet-5-5",
      true,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        display: "summarized",
        type: "adaptive",
      },
      { effort: "low" },
    ],
    ["claude-opus-5", undefined, { type: "disabled" }, undefined],
    [
      "claude-opus-5-5",
      true,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      { effort: "low" },
    ],
    [
      "claude-opus-5-5",
      false,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      undefined,
    ],
    [
      "claude-opus-5-5",
      undefined,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      undefined,
    ],
    [
      "claude-haiku-4-5-20251001",
      true,
      { budget_tokens: 1024, type: "enabled" },
      undefined,
    ],
    [
      "claude-haiku-4-5",
      true,
      { budget_tokens: 1024, type: "enabled" },
      undefined,
    ],
    ["claude-haiku-4-5-20251001", false, undefined, undefined],
  ] as const)(
    "%s thinking enabled=%s",
    async (model, enabled, thinking, outputConfig) => {
      let body: Record<string, unknown> = {};
      let beta: string | null = null;
      const provider = createAnthropicProvider({
        apiKey: "test-key",
        fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          beta = new Headers(init?.headers).get("anthropic-beta");
          return Response.json({
            content: [{ text: "Hello.", type: "text" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        }) as typeof fetch,
        model,
      });
      const result = await provider.generateChat({
        messages: [{ content: "Hello", role: "user" }],
        providerOptions:
          enabled === undefined
            ? undefined
            : { thinking: { effort: "low", enabled } },
        system: "Be helpful.",
      });
      expect(result.content).toBe("Hello.");
      expect(body.model).toBe(model);
      expect(body.thinking).toEqual(thinking);
      expect(body.output_config).toEqual(outputConfig);
      expect(beta === "thinking-binding-controls-2026-08-01").toBe(
        model === "claude-opus-5-5" ||
          (model === "claude-sonnet-5-5" && enabled === true)
      );
      expect(beta === null).toBe(
        model !== "claude-opus-5-5" &&
          !(model === "claude-sonnet-5-5" && enabled === true)
      );
      expect(body.max_tokens).toBe(4096);
      if (model === "claude-opus-5" || model === "claude-opus-5-5") {
        expect(
          (
            await provider.generateText({
              format: "text",
              prompt: "Hello",
              system: "Be helpful.",
            })
          ).content
        ).toBe("Hello.");
        expect(body.thinking).toEqual(
          model === "claude-opus-5-5"
            ? {
                block_binding: { prefix_mismatch_behavior: "drop_block" },
                type: "adaptive",
              }
            : { type: "disabled" }
        );
        expect(body.output_config).toBeUndefined();
        expect(body.max_tokens).toBe(2048);
        expect(beta === "thinking-binding-controls-2026-08-01").toBe(
          model === "claude-opus-5-5"
        );
        expect(beta === null).toBe(model !== "claude-opus-5-5");
      }
    }
  );
});

test("Sonnet 5.5 generateText uses between-tools without binding fields", async () => {
  let body: Record<string, unknown> = {};
  let beta: string | null = null;
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      beta = new Headers(init?.headers).get("anthropic-beta");
      return Response.json({
        content: [{ text: "Hello.", type: "text" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 2 },
      });
    }) as typeof fetch,
    model: "claude-sonnet-5-5",
  });

  await provider.generateText({ format: "text", prompt: "Hello", system: "s" });

  expect(body.thinking).toEqual({ type: "between_tools" });
  expect(body.output_config).toBeUndefined();
  expect(beta).toBeNull();
});

test("Sonnet 5.5 keeps valid between-tools thinking and drops it after prefix edits", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let call = 0;
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      call += 1;
      return Response.json({
        content:
          call === 1
            ? [
                {
                  signature: "signed-progress",
                  thinking: "Checking the tool result",
                  type: "thinking",
                },
                { text: "First answer", type: "text" },
              ]
            : [{ text: "Done.", type: "text" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as typeof fetch,
    model: "claude-sonnet-5-5",
  });
  const firstUser = { content: "First", role: "user" as const };
  const first = await provider.generateChat({
    messages: [firstUser],
    system: "Original prompt",
  });
  const nextUser = { content: "Next", role: "user" as const };

  await provider.generateChat({
    messages: [firstUser, first.assistantMessage, nextUser],
    system: "Original prompt",
  });
  await provider.generateChat({
    messages: [firstUser, first.assistantMessage, nextUser],
    system: "Edited prompt",
  });
  await provider.generateChat({
    messages: [firstUser, first.assistantMessage, nextUser],
    system: "Original prompt",
    tools: [
      {
        description: "Look something up",
        name: "lookup",
        parameters: { properties: {}, type: "object" },
      },
    ],
  });

  const unchanged = requests[1]?.messages as Array<{ content: unknown[] }>;
  const edited = requests[2]?.messages as Array<{ content: unknown[] }>;
  const toolsEdited = requests[3]?.messages as Array<{ content: unknown[] }>;
  expect(unchanged[1]?.content).toEqual([
    {
      signature: "signed-progress",
      thinking: "Checking the tool result",
      type: "thinking",
    },
    { text: "First answer", type: "text" },
  ]);
  expect(edited[1]?.content).toEqual([{ text: "First answer", type: "text" }]);
  expect(toolsEdited[1]?.content).toEqual([
    { text: "First answer", type: "text" },
  ]);
});

test.each(["blocks", "tools"])(
  "Sonnet 5.5 preserves thinking when persisted %s only reorder object keys",
  async (location) => {
    const requests: Array<{
      messages: Array<{ content: unknown[] }>;
      tools: unknown[];
    }> = [];
    const blocks = [
      { signature: "signed-plan", thinking: "Plan", type: "thinking" },
      { data: "opaque-plan", type: "redacted_thinking" },
      { text: "Answer", type: "text" },
    ];
    const tools = [
      {
        description: "Lookup",
        name: "lookup",
        parameters: {
          additionalProperties: false,
          properties: {
            city: { type: "string" },
            count: { default: 0, type: "number" },
          },
          required: ["city", "count"],
          type: "object",
        },
      },
    ];
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          content: blocks,
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 2 },
        });
      }) as typeof fetch,
      model: "claude-sonnet-5-5",
    });
    const user: ChatMessage = { content: "First", role: "user" };
    const first = await provider.generateChat({
      messages: [user],
      system: "s",
      tools,
    });
    const original =
      location === "blocks" ? first.assistantMessage.providerContent : tools;
    const persisted = JSON.parse(
      JSON.stringify(original, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value
      )
    );
    expect(persisted).toEqual(original);
    expect(JSON.stringify(persisted)).not.toBe(JSON.stringify(original));
    await provider.generateChat({
      messages: [
        user,
        location === "blocks"
          ? { ...first.assistantMessage, providerContent: persisted }
          : first.assistantMessage,
        { content: "Next", role: "user" },
      ],
      system: "s",
      tools: location === "tools" ? persisted : tools,
    });
    expect(requests[1]?.messages[1]?.content).toEqual(blocks);
    expect(requests[1]?.tools).toEqual(requests[0]?.tools);
  }
);

test.each([
  "array-order",
  "message-order",
  "boolean",
  "number",
  "null",
  "string",
])(
  "Sonnet 5.5 still invalidates thinking after a %s change",
  async (change) => {
    const requests: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const blocks = [
      { signature: "signed-plan", thinking: "Plan", type: "thinking" },
      { data: "opaque-plan", type: "redacted_thinking" },
      { text: "Answer", type: "text" },
    ];
    const defaults: Record<string, unknown> = {
      choices: ["north", "south"],
      count: 0,
      enabled: false,
      label: "0",
      note: null,
    };
    const tools = [
      {
        description: "Lookup",
        name: "lookup",
        parameters: {
          properties: { options: { default: defaults, type: "object" } },
          type: "object",
        },
      },
    ];
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          content: blocks,
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 2 },
        });
      }) as typeof fetch,
      model: "claude-sonnet-5-5",
    });
    const messages: ChatMessage[] = [
      { content: "First", role: "user" },
      { content: "Second", role: "user" },
    ];
    const first = await provider.generateChat({ messages, system: "s", tools });
    if (change === "array-order") {
      defaults.choices = ["south", "north"];
    }
    if (change === "message-order") {
      messages.reverse();
    }
    if (change === "boolean") {
      defaults.enabled = true;
    }
    if (change === "number") {
      defaults.count = 1;
    }
    if (change === "null") {
      defaults.note = "";
    }
    if (change === "string") {
      defaults.label = 0;
    }
    await provider.generateChat({
      messages: [
        ...messages,
        first.assistantMessage,
        { content: "Next", role: "user" },
      ],
      system: "s",
      tools,
    });
    expect(
      requests[1]?.messages.find((message) => message.role === "assistant")
        ?.content
    ).toEqual([blocks[2]]);
  }
);

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
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
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
      }) as typeof fetch,
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

    for (const messages of [
      [{ content: "Edited", role: "user" } as ChatMessage, ...history.slice(1)],
      [
        { content: "Compacted summary", role: "user" } as ChatMessage,
        ...history.slice(1),
      ],
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

test.each(["low", "medium", "high"] as const)(
  "Sonnet 5.5 adaptive effort=%s and mode switches",
  async (effort) => {
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
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          content: [signed, text],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 2 },
        });
      }) as typeof fetch,
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
);

test("Opus 5.5 replays signed thinking when the system prefix changes", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("anthropic-beta")).toBe(
        "thinking-binding-controls-2026-08-01"
      );
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        content: [{ text: "Done.", type: "text" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as typeof fetch,
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
  expect(
    (requests[1]?.messages as Array<{ content: unknown }> | undefined)?.[1]
      ?.content
  ).toEqual(prior.providerContent);
  expect(requests[1]?.thinking).toEqual({
    block_binding: { prefix_mismatch_behavior: "drop_block" },
    type: "adaptive",
  });
});

describe("parseAnthropicContent", () => {
  test("keeps thinking out of assistant content", () => {
    const result = parseAnthropicContent([
      { thinking: "Plan the answer.", type: "thinking" },
      { text: "Hello.", type: "text" },
    ]);

    expect(result.content).toBe("Hello.");
    expect(result.assistantMessage.thinking).toBe("Plan the answer.");
  });
});
