import { describe, expect, test } from "bun:test";
import {
  defaultDiscoveryBaseUrl,
  isDiscoveryModelProvider,
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
    expect(parseProviderName("cerebras")).toBe("cerebras");
    expect(parseProviderName("fireworks")).toBe("fireworks");
    expect(parseProviderName("minimax")).toBe("minimax");
    expect(parseProviderName("minimax_cn")).toBe("minimax_cn");
    expect(parseProviderName("zhipu")).toBe("zhipu");
    expect(parseProviderName("zhipu_cn")).toBe("zhipu_cn");
    expect(parseProviderName("xai")).toBe("xai");
  });

  test("rejects unknown values", () => {
    expect(parseProviderName("azure")).toBeNull();
    expect(parseProviderName("")).toBeNull();
  });
});

describe("resolveProvider", () => {
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

describe("resolveProvider deepseek", () => {
  test("does not auto-resolve DeepSeek from env API key", () => {
    const provider = resolveProvider({
      env: {
        DEEPSEEK_API_KEY: "sk-test",
      },
    });

    expect(provider).toBeNull();
  });
});

describe("resolveProvider cerebras", () => {
  test("auto-resolves Cerebras when it is the only env API key", () => {
    const provider = resolveProvider({
      env: {
        CEREBRAS_API_KEY: "sk-test",
      },
    });

    expect(provider).toBe("cerebras");
  });
});

describe("resolveProvider fireworks", () => {
  test("auto-resolves Fireworks when it is the only env API key", () => {
    const provider = resolveProvider({
      env: {
        FIREWORKS_API_KEY: "fw-test",
      },
    });

    expect(provider).toBe("fireworks");
  });
});

describe("isDiscoveryModelProvider", () => {
  test("includes providers whose models are discovered from /models", () => {
    expect(isDiscoveryModelProvider("openai_compatible")).toBe(true);
    expect(isDiscoveryModelProvider("minimax")).toBe(true);
    expect(isDiscoveryModelProvider("minimax_cn")).toBe(true);
    expect(isDiscoveryModelProvider("zhipu")).toBe(true);
    expect(isDiscoveryModelProvider("zhipu_cn")).toBe(true);
    expect(isDiscoveryModelProvider("xai")).toBe(true);
  });

  test("excludes catalog providers", () => {
    expect(isDiscoveryModelProvider("deepseek")).toBe(false);
    expect(isDiscoveryModelProvider("openai")).toBe(false);
    expect(isDiscoveryModelProvider("opencode_go")).toBe(false);
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
  });

  test("returns null when the family has no fixed default", () => {
    expect(defaultDiscoveryBaseUrl("openai_compatible")).toBeNull();
    expect(defaultDiscoveryBaseUrl("deepseek")).toBeNull();
  });
});
