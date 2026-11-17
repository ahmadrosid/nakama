import { describe, expect, test } from "bun:test";
import { NakamaApiError, type UserConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { asTestFetch } from "../providers/test-helpers";
import { AgentService } from "./agent-service";
import {
  generateImageWithOpenAI,
  resolveImageGenerationSelection,
} from "./image-generation";
import { LlmUsageTracker } from "./llm-usage-tracker";

const minimaxConfig = (
  type: "minimax" | "minimax_cn",
  imageModel: string
): UserConfig => ({
  defaultProviderId: "p-minimax",
  imageModel,
  providers: [
    {
      apiKey: "minimax-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "p-minimax",
      label: "MiniMax",
      type,
    },
  ],
});

describe("resolveImageGenerationSelection on MiniMax", () => {
  test.each([
    { baseUrl: "https://api.minimax.io/v1", type: "minimax" as const },
    { baseUrl: "https://api.minimaxi.com/v1", type: "minimax_cn" as const },
  ])(
    "resolves a $type image model to its region base URL",
    ({ baseUrl, type }) => {
      expect(
        resolveImageGenerationSelection(
          minimaxConfig(type, "p-minimax::MiniMax-H3-Image-Highspeed")
        )
      ).toMatchObject({
        apiKey: "minimax-key",
        baseUrl,
        model: "MiniMax-H3-Image-Highspeed",
      });
    }
  );

  test("rejects a MiniMax chat model as an image model", () => {
    expect(() =>
      resolveImageGenerationSelection(
        minimaxConfig("minimax", "p-minimax::MiniMax-M3")
      )
    ).toThrow(NakamaApiError);
  });
});

describe("generateImageWithOpenAI request body", () => {
  test.each([
    { area: "1K", format: "b64_json", model: "MiniMax-H3-Image", size: "auto" },
    {
      area: undefined,
      format: "b64_json",
      model: "MiniMax-H3-Image",
      size: "1024x1536",
    },
    { area: undefined, format: undefined, model: "gpt-image-2", size: "auto" },
  ])(
    "$model at $size sends response_format $format and area $area",
    async ({ area, format, model, size }) => {
      let body = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = asTestFetch(async (_input, init) => {
        body = String(init?.body);

        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("png").toString("base64") }],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      });

      try {
        await generateImageWithOpenAI({
          apiKey: "test-key",
          baseUrl: "https://api.minimax.io/v1",
          model,
          prompt: "a cat",
          size,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      const sent = JSON.parse(body);
      expect(sent.response_format).toBe(format);
      expect(sent.area).toBe(area);
    }
  );
});

describe("AgentService MiniMax image generation", () => {
  test("saves a MiniMax image model and generates through the MiniMax API", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);
    const config = minimaxConfig("minimax", "");
    const service = new AgentService(config, null, db, tracker);

    await service.setImageGenerationSettings({
      model: "p-minimax::MiniMax-H3-Image",
    });

    const requests: Array<{ auth: string | null; url: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = asTestFetch(async (input, init) => {
      requests.push({
        auth: new Headers(init?.headers).get("Authorization"),
        url: String(input),
      });

      return new Response(
        JSON.stringify({
          created: 1_792_308_678,
          data: [
            {
              b64_json: Buffer.from("png").toString("base64"),
              revised_prompt: "a small cat",
              size: "1024x1024",
            },
          ],
          output_format: "png",
          request_id: "req-1",
          usage: { input_tokens: 10, output_tokens: 100 },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    let result: Awaited<ReturnType<typeof service.generateImage>>;

    try {
      result = await service.generateImage({ prompt: "a cat" }, "org_minimax");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      {
        auth: "Bearer minimax-key",
        url: "https://api.minimax.io/v1/images/generations",
      },
    ]);
    expect(result).toMatchObject({
      mediaType: "image/png",
      model: "MiniMax-H3-Image",
      revisedPrompt: "a small cat",
    });
    expect(await tracker.getStatsByModel("org_minimax")).toEqual([
      expect.objectContaining({
        inputTokens: 10,
        modelId: "MiniMax-H3-Image",
        outputTokens: 100,
      }),
    ]);
  });
});
