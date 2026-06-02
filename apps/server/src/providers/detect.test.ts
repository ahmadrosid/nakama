import { describe, expect, test } from "bun:test";
import { detectProvider } from "./detect";

describe("detectProvider", () => {
  test("prefers TINYCLAW_PROVIDER over env keys", () => {
    const provider = detectProvider({
      TINYCLAW_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      OPENAI_API_KEY: "sk-test",
    });

    expect(provider).toBe("openrouter");
  });

  test("detects a single configured env API key", () => {
    const provider = detectProvider({
      GEMINI_API_KEY: "test-key",
    });

    expect(provider).toBe("gemini");
  });

  test("returns null when multiple env API keys are set", () => {
    const provider = detectProvider({
      OPENROUTER_API_KEY: "sk-or-v1-test",
      OPENAI_API_KEY: "sk-test",
    });

    expect(provider).toBeNull();
  });

  test("uses user config provider", () => {
    const provider = detectProvider(
      {},
      {
        provider: "openrouter",
        apiKey: "sk-or-v1-test",
        model: "google/gemini-2.5-pro-preview",
      },
    );

    expect(provider).toBe("openrouter");
  });
});
