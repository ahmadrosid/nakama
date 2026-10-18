import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import { asTestFetch } from "../test-helpers";
import { createAnthropicProvider } from "./index";

type CapturedAnthropicRequest = {
  max_tokens?: number;
  messages: Array<{ content: string | unknown[]; role: string }>;
  model?: string;
  output_config?: { effort?: string };
  system?: string;
  thinking?: {
    block_binding?: { prefix_mismatch_behavior?: string };
    budget_tokens?: number;
    display?: string;
    type?: string;
  };
  tools?: unknown[];
};

describe("Anthropic thinking requests", () => {
  test("maps thinking settings for each Anthropic model", async () => {
    const cases: Array<
      readonly [
        string,
        boolean | undefined,
        CapturedAnthropicRequest["thinking"],
        CapturedAnthropicRequest["output_config"],
      ]
    > = [
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
    ];

    for (const [model, enabled, thinking, outputConfig] of cases) {
      let body: CapturedAnthropicRequest = { messages: [] };
      let beta: string | null = null;

      const provider = createAnthropicProvider({
        apiKey: "test-key",
        fetch: asTestFetch(
          async (_input: RequestInfo | URL, init?: RequestInit) => {
            body = JSON.parse(String(init?.body));
            beta = new Headers(init?.headers).get("anthropic-beta");

            return Response.json({
              content: [{ text: "Hello.", type: "text" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 3, output_tokens: 2 },
            });
          }
        ),
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
  });
});

test("Sonnet 5.5 generateText uses between-tools without binding fields", async () => {
  let body: CapturedAnthropicRequest = { messages: [] };
  let beta: string | null = null;

  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: asTestFetch(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        beta = new Headers(init?.headers).get("anthropic-beta");

        return Response.json({
          content: [{ text: "Hello.", type: "text" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 2 },
        });
      }
    ),
    model: "claude-sonnet-5-5",
  });

  await provider.generateText({ format: "text", prompt: "Hello", system: "s" });

  expect(body.thinking).toEqual({ type: "between_tools" });
  expect(body.output_config).toBeUndefined();
  expect(beta).toBeNull();
});

test("Sonnet 5.5 keeps valid between-tools thinking and drops it after prefix edits", async () => {
  const requests: CapturedAnthropicRequest[] = [];
  let call = 0;

  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: asTestFetch(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
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
      }
    ),
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

  const unchanged = requests[1]?.messages ?? [];
  const edited = requests[2]?.messages ?? [];
  const toolsEdited = requests[3]?.messages ?? [];
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
      fetch: asTestFetch(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
          requests.push(JSON.parse(String(init?.body)));

          return Response.json({
            content: blocks,
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
          });
        }
      ),
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
        value instanceof Object && !Array.isArray(value)
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

test("Sonnet 5.5 invalidates thinking after prefix changes", async () => {
  for (const change of [
    "array-order",
    "message-order",
    "boolean",
    "number",
    "null",
    "string",
  ]) {
    const requests: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];

    const blocks = [
      { signature: "signed-plan", thinking: "Plan", type: "thinking" },
      { data: "opaque-plan", type: "redacted_thinking" },
      { text: "Answer", type: "text" },
    ];

    const defaults = {
      choices: ["north", "south"],
      count: 0,
      enabled: false,
      // SAFETY: This fixture changes a string default to a number to test prefix invalidation.
      label: "0" as string | number,
      // SAFETY: This fixture changes a null default to a string to test prefix invalidation.
      note: null as string | null,
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
      fetch: asTestFetch(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(init?.body)).not.toContain("_nakamaPrefixHash");
          requests.push(JSON.parse(String(init?.body)));

          return Response.json({
            content: blocks,
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
          });
        }
      ),
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
});
