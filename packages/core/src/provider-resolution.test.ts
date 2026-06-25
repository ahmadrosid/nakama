import { describe, expect, test } from "bun:test";
import {
  apiKeyEnvVarForProvider,
  parseProviderName,
  resolveProvider,
} from "./provider-resolution";

describe("parseProviderName", () => {
  test("accepts known providers", () => {
    expect(parseProviderName("openai")).toBe("openai");
    expect(parseProviderName("Anthropic")).toBe("anthropic");
    expect(parseProviderName(" GEMINI ")).toBe("gemini");
    expect(parseProviderName("openai_compatible")).toBe("openai_compatible");
    expect(parseProviderName("opencode_go")).toBe("opencode_go");
    expect(parseProviderName("deepseek")).toBe("deepseek");
  });

  test("rejects unknown values", () => {
    expect(parseProviderName("azure")).toBeNull();
    expect(parseProviderName("")).toBeNull();
  });
});

describe("resolveProvider", () => {
  test("prefers TINYCLAW_PROVIDER over env keys", () => {
    const provider = resolveProvider({
      env: {
        TINYCLAW_PROVIDER: "gemini",
        OPENAI_API_KEY: "sk-test",
        GEMINI_API_KEY: "test-key",
      },
    });

    expect(provider).toBe("gemini");
  });

  test("uses configured provider from user config", () => {
    const provider = resolveProvider({
      env: {},
      configuredProvider: "openrouter",
    });

    expect(provider).toBe("openrouter");
  });

  test("uses the only configured env API key", () => {
    const provider = resolveProvider({
      env: {
        GEMINI_API_KEY: "test-key",
      },
    });

    expect(provider).toBe("gemini");
  });

  test("returns null when multiple env API keys are set", () => {
    const provider = resolveProvider({
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENROUTER_API_KEY: "sk-or-test",
      },
    });

    expect(provider).toBeNull();
  });

  test("returns null when provider is not configured", () => {
    expect(resolveProvider({ env: {} })).toBeNull();
  });
});

describe("apiKeyEnvVarForProvider", () => {
  test("maps providers to env vars", () => {
    expect(apiKeyEnvVarForProvider("openai")).toBe("OPENAI_API_KEY");
    expect(apiKeyEnvVarForProvider("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(apiKeyEnvVarForProvider("gemini")).toBe("GEMINI_API_KEY");
    expect(apiKeyEnvVarForProvider("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(apiKeyEnvVarForProvider("openai_compatible")).toBe(
      "OPENAI_COMPATIBLE_API_KEY",
    );
    expect(apiKeyEnvVarForProvider("opencode_go")).toBe("OPENCODE_GO_API_KEY");
    expect(apiKeyEnvVarForProvider("deepseek")).toBeNull();
  });

  test("does not auto-resolve DeepSeek from env API key", () => {
    const provider = resolveProvider({
      env: {
        DEEPSEEK_API_KEY: "sk-test",
      },
    });

    expect(provider).toBeNull();
  });
});
