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
