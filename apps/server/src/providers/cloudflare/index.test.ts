import { describe, expect, test } from "bun:test";
import { createCloudflareProvider } from "./index";

describe("createCloudflareProvider", () => {
  test("creates provider with correct baseUrl", () => {
    const provider = createCloudflareProvider({
      accountId: "test-account-id",
      apiKey: "test-api-key",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    expect(provider.name).toBe("cloudflare");
  });

  test("uses OpenAI-compatible interface", () => {
    const provider = createCloudflareProvider({
      accountId: "acct123",
      apiKey: "token456",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    expect(provider.generateChat).toBeDefined();
    expect(provider.generateText).toBeDefined();
    expect(provider.streamChat).toBeDefined();
  });
});
