import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiKeyEnvVarForProvider,
  defaultDiscoveryBaseUrl,
  isDiscoveryModelProvider,
  parseProviderName,
  resolveProvider,
  USER_PROVIDER_NAMES,
} from "./provider-resolution";

describe("parseProviderName", () => {
  test("accepts known providers", () => {
    expect(parseProviderName("openai")).toBe("openai");
    expect(parseProviderName("chatgpt")).toBe("chatgpt");
    expect(parseProviderName("Anthropic")).toBe("anthropic");
    expect(parseProviderName(" GEMINI ")).toBe("gemini");
    expect(parseProviderName("openai_compatible")).toBe("openai_compatible");
    expect(parseProviderName("opencode_go")).toBe("opencode_go");
    expect(parseProviderName("deepseek")).toBe("deepseek");
    expect(parseProviderName("netra")).toBe("netra");
    expect(parseProviderName("doubao")).toBe("doubao");
    expect(parseProviderName("mistral")).toBe("mistral");
    expect(parseProviderName("perplexity")).toBe("perplexity");
    expect(parseProviderName("cerebras")).toBe("cerebras");
    expect(parseProviderName("fireworks")).toBe("fireworks");
    expect(parseProviderName("minimax")).toBe("minimax");
    expect(parseProviderName("minimax_cn")).toBe("minimax_cn");
    expect(parseProviderName("zhipu")).toBe("zhipu");
    expect(parseProviderName("zhipu_cn")).toBe("zhipu_cn");
    expect(parseProviderName("moonshot")).toBe("moonshot");
    expect(parseProviderName("moonshot_cn")).toBe("moonshot_cn");
    expect(parseProviderName("xai")).toBe("xai");
    expect(parseProviderName("groq")).toBe("groq");
    expect(parseProviderName("together")).toBe("together");
    expect(parseProviderName("qwen")).toBe("qwen");
    expect(parseProviderName("qwen_cn")).toBe("qwen_cn");
    expect(parseProviderName("vercel_ai_gateway")).toBe("vercel_ai_gateway");
    expect(parseProviderName("xiaomi")).toBe("xiaomi");
    expect(parseProviderName("meta")).toBe("meta");
  });

  test("rejects unknown values", () => {
    expect(parseProviderName("azure")).toBeNull();
    expect(parseProviderName("")).toBeNull();
  });
});

describe("apiKeyEnvVarForProvider", () => {
  test("Netra uses its documented API key variable", () => {
    expect(apiKeyEnvVarForProvider("netra")).toBe("NETRA_API_KEY");
    expect(apiKeyEnvVarForProvider("deepseek")).toBe("DEEPSEEK_API_KEY");
  });
  test("Groq uses its documented API key variable", () => {
    expect(apiKeyEnvVarForProvider("groq")).toBe("GROQ_API_KEY");
  });
  test("chatgpt uses OAuth, not an API key env var", () => {
    expect(apiKeyEnvVarForProvider("chatgpt")).toBeNull();
  });
});

describe("resolveProvider", () => {
  test("each registered API key selects its provider when it is the only key", () => {
    for (const provider of USER_PROVIDER_NAMES) {
      const envVar = apiKeyEnvVarForProvider(provider);

      if (envVar) {
        expect(resolveProvider({ env: { [envVar]: "test-key" } })).toBe(
          provider
        );
      }
    }
  });
  test("prefers NAKAMA_PROVIDER over env keys", () => {
    const provider = resolveProvider({
      env: {
        GEMINI_API_KEY: "test-key",
        NAKAMA_PROVIDER: "gemini",
        OPENAI_API_KEY: "sk-test",
      },
    });

    expect(provider).toBe("gemini");
  });

  test("uses configured provider from user config", () => {
    const provider = resolveProvider({
      configuredProvider: "openrouter",
      env: {},
    });

    expect(provider).toBe("openrouter");
  });

  test("uses an API key mounted through a companion file variable", () => {
    const directory = mkdtempSync(join(tmpdir(), "nakama-provider-key-"));
    const keyPath = join(directory, "gemini");
    writeFileSync(keyPath, "mounted-secret\n");

    try {
      expect(
        resolveProvider({
          env: { GEMINI_API_KEY_FILE: keyPath },
        })
      ).toBe("gemini");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("prefers a direct API key over its companion file", () => {
    expect(
      resolveProvider({
        env: {
          GEMINI_API_KEY: "direct-secret",
          GEMINI_API_KEY_FILE: "/missing/secret",
        },
      })
    ).toBe("gemini");
  });

  test("fails when a configured API key file cannot be read", () => {
    expect(() =>
      resolveProvider({
        env: { GEMINI_API_KEY_FILE: "/missing/secret" },
      })
    ).toThrow();
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

describe("resolveProvider deepseek", () => {
  test("auto-resolves DeepSeek from env API key", () => {
    const provider = resolveProvider({
      env: {
        DEEPSEEK_API_KEY: "sk-test",
      },
    });

    expect(provider).toBe("deepseek");
  });
});

describe("isDiscoveryModelProvider", () => {
  test("includes providers whose models are discovered from /models", () => {
    expect(isDiscoveryModelProvider("openai_compatible")).toBe(true);
    expect(isDiscoveryModelProvider("netra")).toBe(true);
    expect(isDiscoveryModelProvider("minimax")).toBe(true);
    expect(isDiscoveryModelProvider("minimax_cn")).toBe(true);
    expect(isDiscoveryModelProvider("zhipu")).toBe(true);
    expect(isDiscoveryModelProvider("zhipu_cn")).toBe(true);
    expect(isDiscoveryModelProvider("xai")).toBe(true);
    expect(isDiscoveryModelProvider("groq")).toBe(true);
    expect(isDiscoveryModelProvider("moonshot")).toBe(true);
    expect(isDiscoveryModelProvider("moonshot_cn")).toBe(true);
  });

  test("excludes catalog providers", () => {
    expect(isDiscoveryModelProvider("deepseek")).toBe(false);
    expect(isDiscoveryModelProvider("doubao")).toBe(false);
    expect(isDiscoveryModelProvider("together")).toBe(false);
    expect(isDiscoveryModelProvider("vercel_ai_gateway")).toBe(false);
    expect(isDiscoveryModelProvider("mistral")).toBe(false);
    expect(isDiscoveryModelProvider("qwen")).toBe(false);
    expect(isDiscoveryModelProvider("qwen_cn")).toBe(false);
    expect(isDiscoveryModelProvider("openai")).toBe(false);
    expect(isDiscoveryModelProvider("opencode_go")).toBe(false);
    expect(isDiscoveryModelProvider("xiaomi")).toBe(false);
  });
});

describe("defaultDiscoveryBaseUrl", () => {
  test("routes each region-split family to its platform URL", () => {
    expect(defaultDiscoveryBaseUrl("minimax")).toBe(
      "https://api.minimax.io/v1"
    );
    expect(defaultDiscoveryBaseUrl("minimax_cn")).toBe(
      "https://api.minimaxi.com/v1"
    );
    expect(defaultDiscoveryBaseUrl("zhipu")).toBe(
      "https://api.z.ai/api/paas/v4"
    );
    expect(defaultDiscoveryBaseUrl("zhipu_cn")).toBe(
      "https://open.bigmodel.cn/api/paas/v4"
    );
    expect(defaultDiscoveryBaseUrl("moonshot")).toBe(
      "https://api.moonshot.ai/v1"
    );
    expect(defaultDiscoveryBaseUrl("moonshot_cn")).toBe(
      "https://api.moonshot.cn/v1"
    );
    expect(defaultDiscoveryBaseUrl("groq")).toBe(
      "https://api.groq.com/openai/v1"
    );
  });

  test("returns null when the family has no fixed default", () => {
    expect(defaultDiscoveryBaseUrl("openai_compatible")).toBeNull();
    expect(defaultDiscoveryBaseUrl("deepseek")).toBeNull();
  });
});
