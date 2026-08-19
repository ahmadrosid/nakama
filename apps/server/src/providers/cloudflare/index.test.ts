import { describe, expect, test } from "bun:test";
import { createCloudflareProvider } from "./index";

describe("createCloudflareProvider", () => {
  test("creates provider with full URL", () => {
    const provider = createCloudflareProvider({
      apiKey: "test-key",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    expect(provider.name).toBe("cloudflare");
  });

  test("creates provider with account ID only", () => {
    const provider = createCloudflareProvider({
      apiKey: "test-key",
      baseUrl: "abc123",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    expect(provider.name).toBe("cloudflare");
  });

  test("uses OpenAI-compatible interface", () => {
    const provider = createCloudflareProvider({
      apiKey: "test-key",
      baseUrl: "abc123",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    expect(provider.generateChat).toBeDefined();
    expect(provider.generateText).toBeDefined();
    expect(provider.streamChat).toBeDefined();
  });
});
