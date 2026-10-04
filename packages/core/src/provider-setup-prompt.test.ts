import { describe, expect, test } from "bun:test";
import { CLOUDFLARE_API_ROOT } from "./cloudflare-provider-config";
import { promptForProviderConfig } from "./provider-setup-prompt";

function scriptedPrompt(answers: string[]) {
  const remaining = [...answers];

  return {
    getDefaultModel: () => "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    getModelById: () => undefined,
    getModelsForProvider: () => [],
    question: async () => remaining.shift() ?? "",
    writeLine: () => {},
  };
}

describe("promptForProviderConfig", () => {
  test("saves a discovered Netra model with its exact ID", async () => {
    const config = await promptForProviderConfig({
      ...scriptedPrompt(["netra", "test-key"]),
      discoverModels: async () => [
        {
          id: "deepseek/deepseek-v4-flash-0731",
          name: "DeepSeek V4 Flash 0731",
          provider: "netra",
          supportsThinking: true,
          supportsVision: false,
        },
      ],
    });
    expect(config.providers[0]?.type).toBe("netra");
    expect(config.providers[0]?.customModels).toEqual([
      {
        default: true,
        id: "deepseek/deepseek-v4-flash-0731",
        supportsThinking: true,
        supportsVision: false,
      },
    ]);
  });
  test("accepts an exact Netra model ID when discovery fails", async () => {
    const config = await promptForProviderConfig({
      ...scriptedPrompt([
        "netra",
        "test-key",
        "deepseek/deepseek-v4-flash-0731",
      ]),
      discoverModels: async () => {
        throw new Error("offline");
      },
    });
    expect(config.providers[0]?.customModels?.[0]?.id).toBe(
      "deepseek/deepseek-v4-flash-0731"
    );
  });
  test("accepts Perplexity as a first-party provider", async () => {
    const config = await promptForProviderConfig(
      scriptedPrompt(["perplexity", "test-key", ""])
    );

    expect(config.providers[0]?.type).toBe("perplexity");
    expect(config.providers[0]?.apiKey).toBe("test-key");
  });

  test("saves a Cloudflare account ID as the instance base URL", async () => {
    const config = await promptForProviderConfig(
      scriptedPrompt(["cloudflare", "test-key", "abc123", ""])
    );

    expect(config.providers[0]?.type).toBe("cloudflare");
    expect(config.providers[0]?.apiKey).toBe("test-key");
    expect(config.providers[0]?.baseUrl).toBe(
      `${CLOUDFLARE_API_ROOT}/abc123/ai/v1`
    );
  });

  test("stores wireApi when the custom endpoint answers responses", async () => {
    const answers = [
      "openai_compatible",
      "Responses Only",
      "https://endpoint.test/v1",
      "",
      "responses",
      "demo-thinker",
    ];
    const config = await promptForProviderConfig(scriptedPrompt(answers));

    expect(config.providers[0]?.wireApi).toBe("responses");

    const chat = await promptForProviderConfig(
      scriptedPrompt(answers.map((a) => (a === "responses" ? "" : a)))
    );

    expect(chat.providers[0]?.wireApi).toBeUndefined();
  });

  test("accepts a pasted Workers AI URL for Cloudflare", async () => {
    const config = await promptForProviderConfig(
      scriptedPrompt([
        "cloudflare",
        "test-key",
        "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1",
        "",
      ])
    );

    expect(config.providers[0]?.baseUrl).toBe(
      `${CLOUDFLARE_API_ROOT}/acct/ai/v1`
    );
  });
});
