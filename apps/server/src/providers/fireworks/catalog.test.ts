import { describe, expect, test } from "bun:test";
import { fetchFireworksGatewayModels, normalizeGatewayModel } from "./catalog";

describe("normalizeGatewayModel", () => {
  test("normalizes full model paths and capability flags", () => {
    const entry = normalizeGatewayModel({
      conversationConfig: {},
      displayName: "Kimi K2.6",
      name: "accounts/fireworks/models/kimi-k2p6",
      serverlessModes: [
        {
          skuInfos: [
            {
              amount: { currencyCode: "USD", nanos: 600_000_000, units: "0" },
              sku: "input-token",
              unit: "1M tokens",
            },
            {
              amount: { currencyCode: "USD", nanos: 500_000_000, units: "2" },
              sku: "output-token",
              unit: "1M tokens",
            },
          ],
        },
      ],
      supportsImageInput: false,
      supportsReasoning: true,
      supportsTools: true,
    });

    expect(entry).toEqual({
      id: "accounts/fireworks/models/kimi-k2p6",
      inputPerMillionUsd: 0.6,
      name: "Kimi K2.6",
      outputPerMillionUsd: 2.5,
      supportsThinking: true,
      supportsVision: false,
    });
  });

  test("skips embedding models", () => {
    expect(
      normalizeGatewayModel({
        kind: "EMBEDDING_MODEL",
        name: "accounts/fireworks/models/nomic-embed-text",
      })
    ).toBeNull();
  });

  test("infers reasoning for known families when gateway omits the flag", () => {
    const entry = normalizeGatewayModel({
      conversationConfig: {},
      displayName: "GPT OSS 120B",
      name: "accounts/fireworks/models/gpt-oss-120b",
    });

    expect(entry?.supportsThinking).toBe(true);
  });
});

describe("fetchFireworksGatewayModels", () => {
  test("paginates until pageToken is exhausted", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      callCount += 1;
      const url = String(input);

      if (callCount === 1) {
        expect(url).toContain("filter=supports_serverless%3Dtrue");
        return new Response(
          JSON.stringify({
            models: [
              {
                conversationConfig: {},
                displayName: "Kimi K2.6",
                name: "accounts/fireworks/models/kimi-k2p6",
                supportsReasoning: true,
              },
            ],
            nextPageToken: "page-2",
          }),
          { status: 200 }
        );
      }

      expect(url).toContain("pageToken=page-2");
      return new Response(
        JSON.stringify({
          models: [
            {
              conversationConfig: {},
              displayName: "GLM 5.2",
              name: "accounts/fireworks/models/glm-5p2",
              supportsReasoning: true,
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const entries = await fetchFireworksGatewayModels("fw_test");
      expect(entries.map((entry) => entry.id)).toEqual([
        "accounts/fireworks/models/glm-5p2",
        "accounts/fireworks/models/kimi-k2p6",
      ]);
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("requires an API key", async () => {
    await expect(fetchFireworksGatewayModels("  ")).rejects.toThrow(
      "API key is required to discover Fireworks models."
    );
  });
});
