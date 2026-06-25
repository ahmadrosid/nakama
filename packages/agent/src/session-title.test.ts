import { describe, expect, test } from "bun:test";
import type { ChatMessage, ProviderClient } from "@tinyclaw/core";
import {
  buildSessionTitlePrompt,
  generateSessionTitleFromMessages,
  normalizeSessionTitle,
} from "./session-title";

describe("session title generation", () => {
  test("buildSessionTitlePrompt includes user and assistant snippets", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Help me refactor the auth middleware" },
      { role: "assistant", content: "Sure, let's start with the session handler." },
    ];

    expect(buildSessionTitlePrompt(messages)).toBe(
      "User: Help me refactor the auth middleware\nAssistant: Sure, let's start with the session handler.",
    );
  });

  test("buildSessionTitlePrompt handles image-only user messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image", mediaType: "image/png", data: "abc" }],
      },
      { role: "assistant", content: "I see a screenshot of your dashboard." },
    ];

    expect(buildSessionTitlePrompt(messages)).toBe(
      "User: [image]\nAssistant: I see a screenshot of your dashboard.",
    );
  });

  test("buildSessionTitlePrompt truncates long snippets", () => {
    const longText = "a".repeat(600);
    const messages: ChatMessage[] = [
      { role: "user", content: longText },
      { role: "assistant", content: "Got it." },
    ];

    const prompt = buildSessionTitlePrompt(messages);

    expect(prompt).toContain(`${"a".repeat(500)}…`);
    expect(prompt).not.toContain("a".repeat(501));
  });

  test("normalizeSessionTitle strips wrapping quotes and whitespace", () => {
    expect(normalizeSessionTitle('  "Fix Auth Middleware"  ')).toBe("Fix Auth Middleware");
    expect(normalizeSessionTitle("'Deploy   Pipeline'")).toBe("Deploy Pipeline");
    expect(normalizeSessionTitle("   ")).toBeNull();
  });

  test("generateSessionTitleFromMessages returns null without provider", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Plan a database migration" },
      { role: "assistant", content: "Let's review the schema first." },
    ];

    await expect(generateSessionTitleFromMessages(messages, {})).resolves.toBeNull();
  });

  test("generateSessionTitleFromMessages returns normalized provider output", async () => {
    const provider: ProviderClient = {
      name: "mock",
      async generateText() {
        return { content: '"Database Migration Plan"' };
      },
      async generateChat() {
        throw new Error("unused");
      },
      async streamChat() {
        throw new Error("unused");
      },
    };

    const messages: ChatMessage[] = [
      { role: "user", content: "Plan a database migration" },
      { role: "assistant", content: "Let's review the schema first." },
    ];

    await expect(generateSessionTitleFromMessages(messages, { provider })).resolves.toBe(
      "Database Migration Plan",
    );
  });

  test("generateSessionTitleFromMessages returns null when provider fails", async () => {
    const provider: ProviderClient = {
      name: "mock",
      async generateText() {
        throw new Error("provider down");
      },
      async generateChat() {
        throw new Error("unused");
      },
      async streamChat() {
        throw new Error("unused");
      },
    };

    const messages: ChatMessage[] = [
      { role: "user", content: "Plan a database migration" },
      { role: "assistant", content: "Let's review the schema first." },
    ];

    await expect(generateSessionTitleFromMessages(messages, { provider })).resolves.toBeNull();
  });
});
