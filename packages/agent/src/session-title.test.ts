import { describe, expect, test } from "bun:test";
import type { ChatMessage, ProviderClient } from "@nakama/core";
import {
  buildSessionTitlePrompt,
  generateSessionTitleFromMessages,
  normalizeSessionTitle,
} from "./session-title";

const conversation: ChatMessage[] = [
  { content: "Plan a database migration", role: "user" },
  { content: "Let's review the schema first.", role: "assistant" },
];

function mockProvider(
  generateText: ProviderClient["generateText"]
): ProviderClient {
  return {
    generateChat: async () => {
      throw new Error("unused");
    },
    generateText,
    name: "mock",
    streamChat: async () => {
      throw new Error("unused");
    },
  };
}

describe("session title generation", () => {
  test("buildSessionTitlePrompt truncates long snippets", () => {
    const prompt = buildSessionTitlePrompt([
      { content: "a".repeat(600), role: "user" },
      { content: "Got it.", role: "assistant" },
    ]);

    expect(prompt).toContain(`${"a".repeat(500)}…`);
    expect(prompt).not.toContain("a".repeat(501));
  });

  test("normalizeSessionTitle strips wrapping quotes and whitespace", () => {
    expect(normalizeSessionTitle('  "Fix Auth Middleware"  ')).toBe(
      "Fix Auth Middleware"
    );
    expect(normalizeSessionTitle("'Deploy   Pipeline'")).toBe(
      "Deploy Pipeline"
    );
    expect(normalizeSessionTitle("   ")).toBeNull();
  });

  test("generateSessionTitleFromMessages uses the first user line without a provider", async () => {
    await expect(
      generateSessionTitleFromMessages(conversation, {})
    ).resolves.toBe("Plan a database migration");
  });

  test("generateSessionTitleFromMessages returns normalized provider output", async () => {
    await expect(
      generateSessionTitleFromMessages(conversation, {
        provider: mockProvider(async () => ({
          content: '"Database Migration Plan"',
        })),
      })
    ).resolves.toBe("Database Migration Plan");
  });

  test("generateSessionTitleFromMessages uses the first user line when the provider fails", async () => {
    await expect(
      generateSessionTitleFromMessages(conversation, {
        provider: mockProvider(async () => {
          throw new Error("provider down");
        }),
      })
    ).resolves.toBe("Plan a database migration");
  });
});
