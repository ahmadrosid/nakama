import { describe, expect, test } from "bun:test";
import { NakamaApiError, type UserConfig } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import { IMAGE_GENERATION_SELECTION } from "../providers/models";
import { estimateUsageCostUsd } from "../providers/pricing";
import { withMswCassette } from "../testing/llm-msw-cassette";
import { AgentService } from "./agent-service";
import {
  fallbackImageGenerationTokens,
  generateImageWithOpenAI,
  normalizeImageGenerationSize,
  resolveImageGenerationSelection,
  resolveImageGenerationTokens,
} from "./image-generation";
import { LlmUsageTracker } from "./llm-usage-tracker";

const openaiConfig = (overrides?: Partial<UserConfig>): UserConfig => ({
  defaultProviderId: "p-openai",
  providers: [
    {
      apiKey: "test-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "p-openai",
      label: "OpenAI",
      type: "openai",
    },
  ],
  ...overrides,
});

const imagesUrl = "https://api.openai.com/v1/images/generations";

describe("resolveImageGenerationSelection", () => {
  test("returns null when image model is not configured", () => {
    expect(resolveImageGenerationSelection(openaiConfig())).toBeNull();
  });

  test("resolves allowlisted openai::gpt-image-2 selection", () => {
    const resolved = resolveImageGenerationSelection(
      openaiConfig({ imageModel: IMAGE_GENERATION_SELECTION })
    );
    expect(resolved?.model).toBe("gpt-image-2");
    expect(resolved?.selection).toBe(IMAGE_GENERATION_SELECTION);
    expect(resolved?.apiKey).toBe("test-key");
    expect(resolved?.instance.id).toBe("p-openai");
  });

  test("rejects non-allowlisted selection", () => {
    expect(() =>
      resolveImageGenerationSelection(
        openaiConfig({ imageModel: "openai::dall-e-3" })
      )
    ).toThrow(NakamaApiError);
  });

  test("fails when OpenAI API key is missing", () => {
    expect(() =>
      resolveImageGenerationSelection(
        openaiConfig({
          imageModel: IMAGE_GENERATION_SELECTION,
          providers: [
            {
              apiKey: "",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "p-openai",
              label: "OpenAI",
              type: "openai",
            },
          ],
        }),
        {}
      )
    ).toThrow(NakamaApiError);
  });
});

describe("normalizeImageGenerationSize / token helpers", () => {
  test("defaults size and rejects unknown sizes", () => {
    expect(normalizeImageGenerationSize(undefined)).toBe("1024x1024");
    expect(() => normalizeImageGenerationSize("512x512")).toThrow(
      NakamaApiError
    );
  });

  test("maps API usage tokens when present", () => {
    expect(
      resolveImageGenerationTokens("hello", "1024x1024", {
        input_tokens: 12,
        output_tokens: 200,
      })
    ).toEqual({ inputTokens: 12, outputTokens: 200 });
  });

  test("falls back when usage is missing", () => {
    const fallback = fallbackImageGenerationTokens("abcd", "1024x1024");
    expect(fallback.inputTokens).toBe(1);
    expect(fallback.outputTokens).toBe(200);
    expect(
      resolveImageGenerationTokens("abcd", "1024x1024", undefined)
    ).toEqual(fallback);
  });
});

describe("generateImageWithOpenAI", () => {
  test("rejects empty prompt before fetch", async () => {
    await expect(
      generateImageWithOpenAI({ apiKey: "test-key", prompt: "  " })
    ).rejects.toThrow(NakamaApiError);
  });

  test("rejects non-gpt-image-2 model before fetch", async () => {
    await expect(
      generateImageWithOpenAI({
        apiKey: "test-key",
        model: "dall-e-3",
        prompt: "a cat",
      })
    ).rejects.toThrow(NakamaApiError);
  });
});

describe("AgentService image generation settings", () => {
  test("round-trips allowlisted model and clears with null", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(openaiConfig(), null, db);

    const saved = await service.setImageGenerationSettings({
      model: IMAGE_GENERATION_SELECTION,
    });
    expect(saved).toEqual({
      imageGeneration: { model: IMAGE_GENERATION_SELECTION },
    });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      imageModel: IMAGE_GENERATION_SELECTION,
    });
    expect(await service.getImageGenerationSettings()).toEqual({
      imageGeneration: { model: IMAGE_GENERATION_SELECTION },
    });

    const cleared = await service.setImageGenerationSettings({ model: null });
    expect(cleared).toEqual({ imageGeneration: { model: null } });
    expect(await db.getWorkspaceSettings()).toMatchObject({ imageModel: null });
  });

  test("rejects non-allowlisted PUT and leaves stored model unchanged (AE1)", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: IMAGE_GENERATION_SELECTION,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });

    const service = new AgentService(
      openaiConfig({ imageModel: IMAGE_GENERATION_SELECTION }),
      null,
      db
    );

    await expect(
      service.setImageGenerationSettings({ model: "openai::dall-e-3" })
    ).rejects.toThrow(NakamaApiError);

    expect(await db.getWorkspaceSettings()).toMatchObject({
      imageModel: IMAGE_GENERATION_SELECTION,
    });
    expect(await service.getImageGenerationSettings()).toEqual({
      imageGeneration: { model: IMAGE_GENERATION_SELECTION },
    });
  });
});

describe("AgentService image generation usage (AE5)", () => {
  test("successful generate increments gpt-image-2 stats and estimated cost", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = await LlmUsageTracker.create(db);
    const service = new AgentService(
      openaiConfig({ imageModel: IMAGE_GENERATION_SELECTION }),
      null,
      db,
      tracker
    );

    await withMswCassette(
      "image-generation-gpt-image-2",
      async () => {
        await service.generateImage({
          prompt: "A tiny red circle on white background, minimal",
          size: "1024x1024",
        });
      },
      { mode: "replay", url: imagesUrl }
    );

    const stats = tracker.getStats();
    expect(stats.requestCount).toBe(1);
    expect(stats.inputTokens).toBe(16);
    expect(stats.outputTokens).toBe(200);
    expect(stats.estimatedCostUsd).toBe(
      estimateUsageCostUsd("gpt-image-2", 16, 200)
    );
    expect(stats.estimatedCostUsd).toBeGreaterThan(0);
    expect(tracker.getStatsByModel()).toEqual([
      expect.objectContaining({
        inputTokens: 16,
        modelId: "gpt-image-2",
        outputTokens: 200,
        requestCount: 1,
      }),
    ]);
  });

  test("failed OpenAI response does not increment usage", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = await LlmUsageTracker.create(db);
    const service = new AgentService(
      openaiConfig({ imageModel: IMAGE_GENERATION_SELECTION }),
      null,
      db,
      tracker
    );

    await expect(
      withMswCassette(
        "image-generation-usage-failure",
        async () =>
          service.generateImage({
            prompt: "should fail",
            size: "1024x1024",
          }),
        { mode: "replay", url: imagesUrl }
      )
    ).rejects.toBeTruthy();

    expect(tracker.getStats().requestCount).toBe(0);
    expect(tracker.getStatsByModel()).toEqual([]);
  });

  test("missing usage object still records fallback tokens so cost moves", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = await LlmUsageTracker.create(db);
    const service = new AgentService(
      openaiConfig({ imageModel: IMAGE_GENERATION_SELECTION }),
      null,
      db,
      tracker
    );

    await withMswCassette(
      "image-generation-usage-no-usage-field",
      async () => {
        await service.generateImage({
          prompt: "abcd",
          size: "1024x1024",
        });
      },
      { mode: "replay", url: imagesUrl }
    );

    const fallback = fallbackImageGenerationTokens("abcd", "1024x1024");
    const stats = tracker.getStats();
    expect(stats.requestCount).toBe(1);
    expect(stats.inputTokens).toBe(fallback.inputTokens);
    expect(stats.outputTokens).toBe(fallback.outputTokens);
    expect(stats.estimatedCostUsd).toBe(
      estimateUsageCostUsd(
        "gpt-image-2",
        fallback.inputTokens,
        fallback.outputTokens
      )
    );
    expect(stats.estimatedCostUsd).toBeGreaterThan(0);
  });
});
