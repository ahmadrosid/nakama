import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createProviderForInstance } from "./create";

describe("compatible provider routing", () => {
  test("allows verified Netra V4.1 and maps retired selections", () => {
    const instance: ProviderInstance = {
      apiKey: "test-key",
      createdAt: "2026-10-05T00:00:00.000Z",
      customModels: [{ id: "deepseek/deepseek-v4.1-flash" }],
      id: "netra-1",
      label: "Netra Runtime",
      type: "netra",
    };

    for (const model of [
      "deepseek/deepseek-v4.1-flash",
      "deepseek/deepseek-v4-flash-0731",
    ]) {
      expect(createProviderForInstance(instance, model)?.name).toBe("netra");
    }

    expect(() =>
      createProviderForInstance(instance, "unverified-model")
    ).toThrow();
  });

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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
        system: "",
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("mimo-v2.5-pro");
      expect(seenThinking).toEqual({ type: "enabled" });

      await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
        system: "",
      });
      expect(seenThinking).toEqual({ type: "disabled" });
    } finally {
      mock.stop(true);
    }
  });
});
