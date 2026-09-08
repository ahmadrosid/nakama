import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createProviderForInstance } from "./create";

describe("createProviderForInstance routing", () => {
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

  test("routes qwen instances to the DashScope compatible-mode path with auth", async () => {
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
        baseUrl: `http://127.0.0.1:${mock.port}/compatible-mode/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_qwen",
        label: "Qwen (DashScope)",
        type: "qwen",
      };

      const client = createProviderForInstance(instance, "qwen3.7-plus");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("qwen");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/compatible-mode/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("qwen3.7-plus");
    } finally {
      mock.stop(true);
    }
  });

  test("routes qwen_cn instances to the DashScope CN compatible-mode path", async () => {
    let seenPath = "";

    const mock = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);
        seenPath = url.pathname;
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
          model: "qwen3.7-plus",
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
        apiKey: "cn-key",
        baseUrl: `http://127.0.0.1:${mock.port}/compatible-mode/v1`,
        createdAt: new Date().toISOString(),
        id: "inst_qwen_cn",
        label: "Qwen (DashScope CN)",
        type: "qwen_cn",
      };

      const client = createProviderForInstance(instance, "qwen3.7-plus");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("qwen_cn");

      await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
      });

      expect(seenPath).toBe("/compatible-mode/v1/chat/completions");
    } finally {
      mock.stop(true);
    }
  });
});
