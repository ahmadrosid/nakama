import { describe, expect, test } from "bun:test";
import {
  buildClaudeCodeSpawnEnv,
  buildCodexSpawnEnv,
  buildPiSpawnEnv,
  buildSpawnEnvForHarness,
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

  test("returns empty spawn env for Cursor Agent even when routing is active", async () => {
    const spawn = await buildSpawnEnvForHarness(
      "cursor_agent",
      activeAnthropicRouting({
        model: "anthropic:claude-opus-4-6",
      }),
      "anthropic",
    );

    expect(spawn.env).toEqual({});
    expect(spawn.cleanup).toBeUndefined();
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

  test("builds pi.dev provider passthrough env for anthropic", async () => {
    const env = await buildPiSpawnEnv(
      activeAnthropicRouting({
        providerType: "anthropic",
        providerLabel: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "test-anthropic-key",
      }),
      "anthropic",
    );
    expect(env.env.PI_CODING_AGENT_DIR).toBeDefined();
    expect(env.cleanup).toBeDefined();
  });

  test("builds pi.dev provider passthrough env for openrouter", async () => {
    const env = await buildPiSpawnEnv(
      activeAnthropicRouting({
        providerType: "openrouter",
        providerLabel: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-test",
      }),
      "openrouter",
    );
    expect(env.env.PI_CODING_AGENT_DIR).toBeDefined();
    expect(env.cleanup).toBeDefined();
  });

  test("builds pi.dev provider passthrough env for openai_compatible", async () => {
    const env = await buildPiSpawnEnv(
      activeAnthropicRouting({
        providerType: "openai_compatible",
        providerLabel: "Custom",
        baseUrl: "https://custom.example.com/v1",
        apiKey: "sk-custom-test",
        model: "custom-model",
      }),
      "openai_compatible",
    );
    expect(env.env.PI_CODING_AGENT_DIR).toBeDefined();
    expect(env.cleanup).toBeDefined();
    // Verify the models.json was written
    const { readFile } = await import("node:fs/promises");
    const modelsJson = JSON.parse(
      await readFile(`${env.env.PI_CODING_AGENT_DIR}/models.json`, "utf-8"),
    );
    expect(modelsJson.providers.nakama).toBeDefined();
    expect(modelsJson.providers.nakama.baseUrl).toBe("https://custom.example.com/v1");
    expect(modelsJson.providers.nakama.apiKey).toBe("sk-custom-test");
    expect(modelsJson.providers.nakama.api).toBe("openai-completions");
    await env.cleanup?.();
  });

  test("uses nakama provider in models.json for anthropic with custom base URL", async () => {
    const env = await buildPiSpawnEnv(
      activeAnthropicRouting({
        providerType: "anthropic",
        providerLabel: "Anthropic Proxy",
        baseUrl: "https://proxy.example.com/v1",
        apiKey: "sk-proxy-test",
        model: "claude-sonnet-4-6",
      }),
      "anthropic",
    );
    const { readFile } = await import("node:fs/promises");
    const modelsJson = JSON.parse(
      await readFile(`${env.env.PI_CODING_AGENT_DIR}/models.json`, "utf-8"),
    );
    // Custom base URL → nakama provider with openai-completions, NOT anthropic
    expect(modelsJson.providers.nakama).toBeDefined();
    expect(modelsJson.providers.anthropic).toBeUndefined();
    expect(modelsJson.providers.nakama.api).toBe("openai-completions");
    expect(modelsJson.providers.nakama.baseUrl).toBe("https://proxy.example.com/v1");
    await env.cleanup?.();
  });

  test("overrides built-in anthropic provider for default base URL", async () => {
    const env = await buildPiSpawnEnv(
      activeAnthropicRouting({
        providerType: "anthropic",
        providerLabel: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-6",
      }),
      "anthropic",
    );
    const { readFile } = await import("node:fs/promises");
    const modelsJson = JSON.parse(
      await readFile(`${env.env.PI_CODING_AGENT_DIR}/models.json`, "utf-8"),
    );
    // Default base URL → override built-in anthropic provider
    expect(modelsJson.providers.anthropic).toBeDefined();
    expect(modelsJson.providers.nakama).toBeUndefined();
    expect(modelsJson.providers.anthropic.apiKey).toBe("sk-ant-test");
    await env.cleanup?.();
  });

  test("returns no env overrides when routing is inactive for pi", async () => {
    const env = await buildPiSpawnEnv(inactiveRouting(), "openai");
    expect(env.env).toEqual({});
    expect(env.cleanup).toBeUndefined();
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
