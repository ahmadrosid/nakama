import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createProviderForInstance } from "./create";

// Locks endpoint routing per provider family: the switch in create.ts must
// dispatch each instance type to its platform base URL, or chat silently
// goes to the wrong vendor. Offline by construction — the override points
// at a local mock instead of the real API.
describe("createProviderForInstance routing", () => {
  test("routes groq instances to the configured base URL with auth", async () => {
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
        // Mirrors what the settings Discover flow saves after fetching
        // /models from the platform.
        customModels: [{ default: true, id: "llama-3.3-70b" }],
        id: "inst_groq",
        label: "Groq",
        type: "groq",
        updatedAt: new Date().toISOString(),
      };

      const client = createProviderForInstance(instance, "llama-3.3-70b");

      expect(client).not.toBeNull();
      expect(client?.name).toBe("groq");

      const result = await client!.generateChat({
        messages: [{ content: "ping", role: "user" }],
        model: "llama-3.3-70b",
      });

      expect(result.content).toBe("ok");
      expect(seenPath).toBe("/v1/chat/completions");
      expect(seenAuth).toBe("Bearer test-key");
      expect(seenModel).toBe("llama-3.3-70b");
    } finally {
      mock.stop(true);
    }
  });
});
