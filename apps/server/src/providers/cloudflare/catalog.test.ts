import { afterEach, expect, mock, test } from "bun:test";
import { asTestFetch } from "../test-helpers";
import { fetchCloudflareWorkersAiModels } from "./catalog";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("lists the account's text generation models with their limits and rates", async () => {
  const fetchMock = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe("/client/v4/accounts/abc123/ai/models/search");
      expect(url.searchParams.get("task")).toBe("Text Generation");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer test-key"
      );

      // Shape taken from a live /ai/models/search response.
      return Response.json({
        result: [
          {
            name: "@cf/openai/gpt-oss-120b",
            properties: [
              { property_id: "context_window", value: "128000" },
              {
                property_id: "price",
                value: [
                  { currency: "USD", price: 0.35, unit: "per M input tokens" },
                  { currency: "USD", price: 0.75, unit: "per M output tokens" },
                ],
              },
              { property_id: "reasoning", value: "true" },
            ],
          },
          {
            name: "@cf/swiss-ai/apertus-v1.5-8b",
            properties: [
              { property_id: "context_window", value: "262144" },
              { property_id: "vision", value: "true" },
            ],
          },
          { name: "not-a-workers-ai-id", properties: [] },
        ],
        success: true,
      });
    }
  );

  globalThis.fetch = asTestFetch(fetchMock);

  const models = await fetchCloudflareWorkersAiModels(
    "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
    "test-key"
  );

  // A short page means there is no second request.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(models).toEqual([
    {
      contextWindow: 128_000,
      id: "@cf/openai/gpt-oss-120b",
      inputPerMillionUsd: 0.35,
      name: "gpt-oss-120b",
      outputPerMillionUsd: 0.75,
      supportsThinking: false,
      supportsVision: false,
    },
    {
      contextWindow: 262_144,
      id: "@cf/swiss-ai/apertus-v1.5-8b",
      name: "apertus-v1.5-8b",
      supportsThinking: false,
      supportsVision: true,
    },
  ]);
});

test("refuses a base URL without an account ID", async () => {
  await expect(
    fetchCloudflareWorkersAiModels("https://example.com/v1", "test-key")
  ).rejects.toThrow("account ID");
});
