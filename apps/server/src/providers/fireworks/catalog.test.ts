import { describe, expect, test } from "bun:test";
import {
  fetchFireworksGatewayModels,
  normalizeGatewayModel,
} from "./catalog";

describe("normalizeGatewayModel", () => {
  test("normalizes full model paths and capability flags", () => {
    const entry = normalizeGatewayModel({
      name: "accounts/fireworks/models/kimi-k2p6",
      displayName: "Kimi K2.6",
      supportsTools: true,
      supportsImageInput: false,
      supportsReasoning: true,
      conversationConfig: {},
      serverlessModes: [
        {
          skuInfos: [
            {
              sku: "input-token",
              amount: { currencyCode: "USD", units: "0", nanos: 600_000_000 },
              unit: "1M tokens",
            },
            {
              sku: "output-token",
              amount: { currencyCode: "USD", units: "2", nanos: 500_000_000 },
              unit: "1M tokens",
            },
          ],
        },
      ],
    });

    expect(entry).toEqual({
      id: "accounts/fireworks/models/kimi-k2p6",
      name: "Kimi K2.6",
      supportsThinking: true,
      supportsVision: false,
      inputPerMillionUsd: 0.6,
      outputPerMillionUsd: 2.5,
    });
  });

  test("skips embedding models", () => {
    expect(
      normalizeGatewayModel({
        name: "accounts/fireworks/models/nomic-embed-text",
        kind: "EMBEDDING_MODEL",
      }),
    ).toBeNull();
  });

  test("infers reasoning for known families when gateway omits the flag", () => {
    const entry = normalizeGatewayModel({
      name: "accounts/fireworks/models/gpt-oss-120b",
      displayName: "GPT OSS 120B",
      conversationConfig: {},
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
                name: "accounts/fireworks/models/kimi-k2p6",
                displayName: "Kimi K2.6",
                conversationConfig: {},
                supportsReasoning: true,
              },
            ],
            nextPageToken: "page-2",
          }),
          { status: 200 },
        );
      }

      expect(url).toContain("pageToken=page-2");
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "accounts/fireworks/models/glm-5p2",
              displayName: "GLM 5.2",
              conversationConfig: {},
              supportsReasoning: true,
            },
          ],
        }),
        { status: 200 },
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
      "API key is required to discover Fireworks models.",
    );
  });
});
