import { describe, expect, test } from "bun:test";
import { createSqliteDatabase } from "./adapters/sqlite";
import { LLM_USAGE_STATS_ID } from "./constants";

describe("llm usage stats persistence", () => {
  test("sqlite adapter accumulates usage deltas", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const trackedSince = "2026-06-05T00:00:00.000Z";

    try {
      await db.incrementLlmUsageStats(
        {
          estimatedCostUsd: 0.05,
          inputTokens: 400,
          outputTokens: 100,
          requestCount: 2,
        },
        trackedSince
      );

      const stats = await db.getLlmUsageStats();
      const byModel = await db.listLlmUsageStatsByModel();
      expect(stats).toEqual({
        estimatedCostUsd: 0.05,
        id: LLM_USAGE_STATS_ID,
        inputTokens: 400,
        outputTokens: 100,
        requestCount: 2,
        trackedSince,
        updatedAt: expect.any(String),
      });
      expect(byModel).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("adapters accumulate per-model usage deltas", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const trackedSince = "2026-06-05T00:00:00.000Z";

    try {
      await db.incrementLlmUsageStatsByModel(
        "gpt-4o",
        {
          estimatedCostUsd: 0.01,
          inputTokens: 100,
          outputTokens: 50,
          requestCount: 1,
        },
        trackedSince
      );
      await db.incrementLlmUsageStatsByModel(
        "gpt-4o-mini",
        {
          estimatedCostUsd: 0.005,
          inputTokens: 120,
          outputTokens: 30,
          requestCount: 2,
        },
        trackedSince
      );
      await db.incrementLlmUsageStatsByModel(
        "gpt-4o",
        {
          estimatedCostUsd: 0.008,
          inputTokens: 80,
          outputTokens: 20,
          requestCount: 1,
        },
        trackedSince
      );

      expect(await db.listLlmUsageStatsByModel()).toEqual([
        {
          estimatedCostUsd: 0.018_000_000_000_000_002,
          inputTokens: 180,
          modelId: "gpt-4o",
          outputTokens: 70,
          requestCount: 2,
          trackedSince,
          updatedAt: expect.any(String),
        },
        {
          estimatedCostUsd: 0.005,
          inputTokens: 120,
          modelId: "gpt-4o-mini",
          outputTokens: 30,
          requestCount: 2,
          trackedSince,
          updatedAt: expect.any(String),
        },
      ]);
    } finally {
      database.close();
    }
  });
});
