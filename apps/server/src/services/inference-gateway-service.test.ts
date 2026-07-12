import { afterEach, describe, expect, test } from "bun:test";
import type { ProviderClient } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { handleAnthropicMessagesRequest } from "./inference-gateway-service";

const previousGatewayFlag = process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;

afterEach(() => {
  if (previousGatewayFlag === undefined) {
    delete process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;
  } else {
    process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = previousGatewayFlag;
  }
});

describe("inference gateway service", () => {
  test("routes Anthropic requests through the profile provider", async () => {
    process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = "1";

    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      id: "profile_default",
      name: "Default",
      systemPrompt: "You are helpful.",
      model: "anthropic:claude-sonnet-4-6",
      isSuper: true,
      orgId: "org_test",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const provider: ProviderClient = {
      name: "anthropic",
      async generateText() {
        return { content: "ok" };
      },
      async generateChat() {
        return {
          content: "Gateway reply",
          toolCalls: [],
          assistantMessage: { role: "assistant", content: "Gateway reply" },
          usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
        };
      },
      async streamChat() {
        throw new Error("not used in this test");
      },
    };

    const response = await handleAnthropicMessagesRequest({
      db,
      userConfig: {
        defaultProviderId: null,
        providers: [],
      },
      context: { orgId: "org_test", profileId: "profile_default" },
      body: {
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        messages: [{ role: "user", content: "Hello" }],
      },
      provider,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      role: string;
      content: Array<{ type: string; text: string }>;
    };

    expect(body.role).toBe("assistant");
    expect(body.content[0]?.text).toBe("Gateway reply");
  });
});
