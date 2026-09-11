import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createProviderForInstance } from "./create";

describe("createProviderForInstance routing", () => {
  test("routes xiaomi instances to the configured base URL with auth", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenModel = "";
    let seenThinking: unknown;

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        const body = (await request.json()) as {
          model?: string;
          thinking?: unknown;
        };
        seenModel = body.model ?? "";
        seenThinking = body.thinking;
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          created: 1,
          id: "mock",
          model: seenModel,
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_xiaomi",
        label: "Xiaomi MiMo",
        type: "xiaomi",
      };

      const client = createProviderForInstance(instance, "mimo-v2.5-pro");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("xiaomi");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
        providerOptions: { thinking: { effort: "high", enabled: true } },
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("mimo-v2.5-pro");
      expect(seenThinking).toEqual({ type: "enabled" });

      await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });
      expect(seenThinking).toEqual({ type: "disabled" });
    } finally {
      mock.stop(true);
    }
  });

  test("creates an xai client from an xai instance", () => {
    const instance: ProviderInstance = {
      apiKey: "test-key",
      createdAt: new Date().toISOString(),
      customModels: [{ default: true, id: "grok-4" }],
      id: "inst_xai",
      label: "xAI Grok",
      type: "xai",
    };

    const client = createProviderForInstance(instance, "grok-4");

    expect(client).not.toBeNull();
    expect(client?.name).toBe("xai");
  });

  test("routes together instances to the configured base URL with auth", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenModel = "";

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        const body = (await request.json()) as { model?: string };
        seenModel = body.model ?? "";
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          created: 1,
          id: "mock",
          model: seenModel,
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_together",
        label: "Together AI",
        type: "together",
      };

      const client = createProviderForInstance(instance, "openai/gpt-oss-120b");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("together");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("openai/gpt-oss-120b");
    } finally {
      mock.stop(true);
    }
  });

  test("routes vercel_ai_gateway instances to the configured base URL with auth", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenModel = "";
    let seenReasoning: unknown;

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        const body = (await request.json()) as {
          model?: string;
          reasoning?: unknown;
        };
        seenModel = body.model ?? "";
        seenReasoning = body.reasoning;
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                content: "ok",
                reasoning: "because",
                role: "assistant",
              },
            },
          ],
          created: 1,
          id: "mock",
          model: seenModel,
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_vercel_ai_gateway",
        label: "Vercel AI Gateway",
        type: "vercel_ai_gateway",
      };

      const client = createProviderForInstance(instance, "openai/gpt-4o-mini");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("vercel_ai_gateway");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
        providerOptions: { thinking: { effort: "medium", enabled: true } },
      });

      expect(result.content).toBe("ok");
      expect(result.assistantMessage.thinking).toBe("because");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("openai/gpt-4o-mini");
      expect(seenReasoning).toEqual({ effort: "medium", enabled: true });
    } finally {
      mock.stop(true);
    }
  });

  test("routes mistral instances to the configured base URL with auth", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenModel = "";

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        const body = (await request.json()) as { model?: string };
        seenModel = body.model ?? "";
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          created: 1,
          id: "mock",
          model: seenModel,
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_mistral",
        label: "Mistral",
        type: "mistral",
      };

      const client = createProviderForInstance(instance, "mistral-small-2603");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("mistral");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("mistral-small-2603");
    } finally {
      mock.stop(true);
    }
  });

  test.each([
    {
      apiKey: "test-key",
      id: "inst_qwen",
      label: "Qwen (DashScope)",
      type: "qwen" as const,
    },
    {
      apiKey: "cn-key",
      id: "inst_qwen_cn",
      label: "Qwen (DashScope CN)",
      type: "qwen_cn" as const,
    },
  ])(
    "routes $type instances to the DashScope compatible-mode path with auth",
    async ({ apiKey, id, label, type }) => {
      let seenPath = "";
      let seenAuth = "";
      let seenModel = "";
      let seenEnableThinking: unknown;

      const mock = Bun.serve({
        fetch: async (request) => {
          const url = new URL(request.url);
          seenPath = url.pathname;
          seenAuth = request.headers.get("authorization") ?? "";
          const body = (await request.json()) as {
            enable_thinking?: unknown;
            model?: string;
          };
          seenModel = body.model ?? "";
          seenEnableThinking = body.enable_thinking;
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                message: { content: "ok", role: "assistant" },
              },
            ],
            created: 1,
            id: "mock",
            model: seenModel,
            object: "chat.completion",
            usage: {
              completion_tokens: 1,
              prompt_tokens: 1,
              total_tokens: 2,
            },
          });
        },
        port: 0,
      });

      try {
        const instance: ProviderInstance = {
          apiKey,
          baseUrl: `http://127.0.0.1:${mock.port}/compatible-mode/v1`,
          createdAt: new Date().toISOString(),
          id,
          label,
          type,
        };

        const client = createProviderForInstance(instance, "qwen3.7-plus");

        expect(client).not.toBeNull();
        expect(client?.name).toBe(type);

        const result = await client!.generateChat({
          messages: [{ content: "ping", role: "user" }],
          providerOptions: { thinking: { effort: "medium", enabled: true } },
        });

        expect(result.content).toBe("ok");
        expect(seenPath).toBe("/compatible-mode/v1/chat/completions");
        expect(seenAuth).toBe(`Bearer ${apiKey}`);
        expect(seenModel).toBe("qwen3.7-plus");
        expect(seenEnableThinking).toBe(true);

        await client!.generateChat({
          messages: [{ content: "ping", role: "user" }],
        });
        expect(seenEnableThinking).toBe(false);
      } finally {
        mock.stop(true);
      }
    }
  );

  test("routes doubao instances to the Ark /api/v3 chat completions path", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenModel = "";
    let seenThinking: unknown;
    let seenReasoningEffort: unknown;

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        const body = (await request.json()) as {
          model?: string;
          reasoning_effort?: unknown;
          thinking?: unknown;
        };
        seenModel = body.model ?? "";
        seenThinking = body.thinking;
        seenReasoningEffort = body.reasoning_effort;
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          created: 1,
          id: "mock",
          model: seenModel,
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}/api/v3`,
        createdAt: new Date().toISOString(),
        id: "inst_doubao",
        label: "Doubao (Volcengine)",
        type: "doubao",
      };

      const client = createProviderForInstance(
        instance,
        "doubao-seed-2-1-pro-260628"
      );

      expect(client).not.toBeNull();
      expect(client?.name).toBe("doubao");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
        providerOptions: { thinking: { effort: "high", enabled: true } },
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/api/v3/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("doubao-seed-2-1-pro-260628");
      expect(seenThinking).toEqual({ type: "enabled" });
      expect(seenReasoningEffort).toBeUndefined();

      await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });
      expect(seenThinking).toEqual({ type: "disabled" });
      expect(seenReasoningEffort).toBeUndefined();
    } finally {
      mock.stop(true);
    }
  });

  test("routes perplexity chat and keeps citations while omitting local tools", async () => {
    let seenPath = "";
    let seenAuth = "";
    const seenBodies: Array<Record<string, unknown>> = [];

    const mock = Bun.serve({
      fetch: async (request) => {
        seenPath = new URL(request.url).pathname;
        seenAuth = request.headers.get("authorization") ?? "";
        seenBodies.push((await request.json()) as Record<string, unknown>);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                content: "Grounded answer.[1][2]",
                role: "assistant",
              },
            },
          ],
          citations: ["https://one.test/a", "https://two.test/b"],
          model: "sonar",
          usage: {
            completion_tokens: 3,
            prompt_tokens: 2,
            total_tokens: 5,
          },
        });
      },
      port: 0,
    });

    try {
      const instance: ProviderInstance = {
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${mock.port}`,
        createdAt: new Date().toISOString(),
        id: "inst_perplexity",
        label: "Perplexity Sonar",
        type: "perplexity",
      };
      const client = createProviderForInstance(instance, "sonar");

      const result = await client!.generateChat({
        messages: [{ content: "What changed?", role: "user" }],
        system: "Answer with sources.",
        tools: [
          {
            description: "Look up a local record",
            name: "lookup",
            parameters: { type: "object" },
          },
        ],
      });

      expect(client?.name).toBe("perplexity");
      expect(seenPath).toBe("/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenBodies[0]?.model).toBe("sonar");
      expect(seenBodies[0]?.tools).toBeUndefined();
      expect(result.content).toContain("Grounded answer.[1][2]");
      expect(result.content).toContain("1. <https://one.test/a>");
      expect(result.content).toContain("2. <https://two.test/b>");

      await client!.generateText({
        prompt: "Return JSON",
        system: "Return a result.",
      });
      expect(seenBodies[1]?.response_format).toBeUndefined();
    } finally {
      mock.stop(true);
    }
  });
});
