import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import {
  getProviderApiBaseUrl,
  isProviderCompatibleWithHarness,
  resolveCodingAgentProviderRouting,
} from "./coding-agent-provider-routing";
import { makeAnthropicProvider } from "./coding-agent-fixtures";

const anthropicProvider = makeAnthropicProvider();

const openaiProvider: ProviderInstance = {
  id: "prov_openai",
  type: "openai",
  label: "OpenAI",
  apiKey: "sk-openai-test",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const geminiProvider: ProviderInstance = {
  id: "prov_gemini",
  type: "gemini",
  label: "Gemini",
  apiKey: "gemini-test",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("coding-agent provider routing", () => {
  test("anthropic provider routes to Claude Code with Anthropic base URL", () => {
    const routing = resolveCodingAgentProviderRouting({
      userConfig: {
        providers: [anthropicProvider],
        defaultProviderId: anthropicProvider.id,
      },
      profileModel: "anthropic:claude-sonnet-4-6",
      harnessKind: "claude_code",
    });

    expect(routing.active).toBe(true);
    expect(routing.compatible).toBe(true);
    expect(routing.baseUrl).toBe("https://api.anthropic.com");
    expect(routing.apiKey).toBe("sk-ant-test");
  });

  test("openai provider routes to Codex with OpenAI-compatible URL", () => {
    const routing = resolveCodingAgentProviderRouting({
      userConfig: {
        providers: [openaiProvider],
        defaultProviderId: openaiProvider.id,
      },
      profileModel: "openai:gpt-4.1",
      harnessKind: "codex",
    });

    expect(routing.active).toBe(true);
    expect(routing.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("gemini provider is incompatible with Claude Code", () => {
    const routing = resolveCodingAgentProviderRouting({
      userConfig: {
        providers: [geminiProvider],
        defaultProviderId: geminiProvider.id,
      },
      profileModel: "gemini-2.5-pro",
      harnessKind: "claude_code",
    });

    expect(routing.compatible).toBe(false);
    expect(routing.active).toBe(false);
    expect(routing.error).toContain("Anthropic");
  });

  test("compatibility matrix covers harness/provider pairs", () => {
    expect(isProviderCompatibleWithHarness("anthropic", "claude_code")).toBe(true);
    expect(isProviderCompatibleWithHarness("openrouter", "claude_code")).toBe(false);
    expect(isProviderCompatibleWithHarness("openai", "codex")).toBe(true);
    expect(isProviderCompatibleWithHarness("gemini", "codex")).toBe(false);
    expect(isProviderCompatibleWithHarness("openrouter", "opencode")).toBe(true);
  });

  test("getProviderApiBaseUrl resolves OpenRouter chat endpoint for Codex", () => {
    expect(
      getProviderApiBaseUrl(
        {
          id: "prov_or",
          type: "openrouter",
          label: "OpenRouter",
          apiKey: "sk-or-test",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        "codex",
      ),
    ).toBe("https://openrouter.ai/api/v1");
  });
});
