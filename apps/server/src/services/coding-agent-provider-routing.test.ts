import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { makeAnthropicProvider } from "./coding-agent-fixtures";
import {
  getProviderApiBaseUrl,
  isProviderCompatibleWithHarness,
  resolveCodingAgentProviderRouting,
} from "./coding-agent-provider-routing";

const anthropicProvider = makeAnthropicProvider();

const openaiProvider: ProviderInstance = {
  apiKey: "sk-openai-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "prov_openai",
  label: "OpenAI",
  type: "openai",
};

const geminiProvider: ProviderInstance = {
  apiKey: "gemini-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "prov_gemini",
  label: "Gemini",
  type: "gemini",
};

describe("coding-agent provider routing", () => {
  test("Cursor Agent is never provider-compatible", () => {
    expect(isProviderCompatibleWithHarness("anthropic", "cursor_agent")).toBe(
      false
    );
    expect(isProviderCompatibleWithHarness("openai", "cursor_agent")).toBe(
      false
    );
  });

  test("anthropic provider routes to Claude Code with Anthropic base URL", () => {
    const routing = resolveCodingAgentProviderRouting({
      harnessKind: "claude_code",
      profileModel: "anthropic:claude-sonnet-4-6",
      userConfig: {
        defaultProviderId: anthropicProvider.id,
        providers: [anthropicProvider],
      },
    });

    expect(routing.active).toBe(true);
    expect(routing.compatible).toBe(true);
    expect(routing.baseUrl).toBe("https://api.anthropic.com");
    expect(routing.apiKey).toBe("sk-ant-test");
  });

  test("openai provider routes to Codex with OpenAI-compatible URL", () => {
    const routing = resolveCodingAgentProviderRouting({
      harnessKind: "codex",
      profileModel: "openai:gpt-4.1",
      userConfig: {
        defaultProviderId: openaiProvider.id,
        providers: [openaiProvider],
      },
    });

    expect(routing.active).toBe(true);
    expect(routing.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("gemini provider is incompatible with Claude Code", () => {
    const routing = resolveCodingAgentProviderRouting({
      harnessKind: "claude_code",
      profileModel: "gemini-2.5-pro",
      userConfig: {
        defaultProviderId: geminiProvider.id,
        providers: [geminiProvider],
      },
    });

    expect(routing.compatible).toBe(false);
    expect(routing.active).toBe(false);
    expect(routing.error).toContain("Anthropic");
  });

  test("compatibility matrix covers harness/provider pairs", () => {
    expect(isProviderCompatibleWithHarness("anthropic", "claude_code")).toBe(
      true
    );
    expect(isProviderCompatibleWithHarness("openrouter", "claude_code")).toBe(
      false
    );
    expect(isProviderCompatibleWithHarness("openai", "codex")).toBe(true);
    expect(isProviderCompatibleWithHarness("gemini", "codex")).toBe(false);
    expect(isProviderCompatibleWithHarness("openrouter", "opencode")).toBe(
      true
    );
  });

  test("getProviderApiBaseUrl resolves OpenRouter chat endpoint for Codex", () => {
    expect(
      getProviderApiBaseUrl(
        {
          apiKey: "sk-or-test",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "prov_or",
          label: "OpenRouter",
          type: "openrouter",
        },
        "codex"
      )
    ).toBe("https://openrouter.ai/api/v1");
  });
});
