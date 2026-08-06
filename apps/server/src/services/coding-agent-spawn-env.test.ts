import { describe, expect, test } from "bun:test";
import {
  buildClaudeCodeSpawnEnv,
  buildCodexSpawnEnv,
  mergeCodingAgentSpawnEnv,
  normalizeCodingAgentModel,
  redactSpawnEnvForPrompt,
} from "./coding-agent-spawn-env";

import { inactiveRouting, activeAnthropicRouting } from "./coding-agent-fixtures";

describe("coding-agent spawn env", () => {
  test("normalizes profile model ids", () => {
    expect(normalizeCodingAgentModel("anthropic:claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeCodingAgentModel("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  test("returns no env overrides when routing is inactive", () => {
    expect(buildClaudeCodeSpawnEnv(inactiveRouting)).toEqual({});
  });

  test("builds Claude Code provider passthrough env", () => {
    const env = buildClaudeCodeSpawnEnv(
      activeAnthropicRouting({
        model: "anthropic:claude-opus-4-6",
      }),
      "anthropic",
    );

    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-opus-4-6");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  test("builds Codex provider passthrough env", () => {
    expect(
      buildCodexSpawnEnv(
        activeAnthropicRouting({
          providerType: "openai",
          providerLabel: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai-test",
          model: "openai:gpt-4.1",
        }),
        "openai",
      ),
    ).toEqual({
      OPENAI_API_KEY: "sk-openai-test",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_MODEL: "gpt-4.1",
    });
  });

  test("protects credential env keys from caller overrides", () => {
    const env = mergeCodingAgentSpawnEnv(
      { HOME: "/tmp" },
      {
        ANTHROPIC_API_KEY: "sk-from-nakama",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      },
      {
        protectCredentialKeys: true,
        callerEnv: {
          ANTHROPIC_API_KEY: "sk-override",
          CUSTOM_FLAG: "1",
        },
      },
    );

    expect(env.ANTHROPIC_API_KEY).toBe("sk-from-nakama");
    expect(env.CUSTOM_FLAG).toBe("1");
  });

  test("redacts secrets for prompt context", () => {
    expect(
      redactSpawnEnvForPrompt({
        ANTHROPIC_API_KEY: "sk-ant-test",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        OPENAI_MODEL: "gpt-4.1",
      }),
    ).toEqual({
      ANTHROPIC_API_KEY: "***",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      OPENAI_MODEL: "gpt-4.1",
    });
  });
});
