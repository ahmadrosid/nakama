import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { LlmUsageTracker } from "./llm-usage-tracker";

describe("LlmUsageTracker", () => {
  test("loads persisted stats and increments them on record", async () => {
    const db = createInMemoryDatabaseAdapter();
    const trackedSince = "2026-06-05T00:00:00.000Z";

    await db.incrementLlmUsageStats(
      {
        estimatedCostUsd: 0.12,
        inputTokens: 900,
        outputTokens: 300,
        requestCount: 3,
      },
      trackedSince
    );

    const tracker = await LlmUsageTracker.create(db);
    tracker.record("gpt-4o", 100, 50);

    expect(tracker.getStats()).toEqual({
      estimatedCostUsd: expect.any(Number),
      inputTokens: 1000,
      outputTokens: 350,
      requestCount: 4,
      totalTokens: 1350,
      trackedSince,
    });

    const persisted = await db.getLlmUsageStats();
    const persistedByModel = await db.listLlmUsageStatsByModel();
    expect(persisted?.requestCount).toBe(4);
    expect(persisted?.inputTokens).toBe(1000);
    expect(persisted?.outputTokens).toBe(350);
    expect(persisted?.trackedSince).toBe(trackedSince);
    expect(tracker.getStatsByModel()).toEqual([
      {
        estimatedCostUsd: expect.any(Number),
        inputTokens: 100,
        modelId: "gpt-4o",
        outputTokens: 50,
        requestCount: 1,
        totalTokens: 150,
        trackedSince: expect.any(String),
      },
    ]);
    expect(persistedByModel).toEqual([
      {
        estimatedCostUsd: expect.any(Number),
        inputTokens: 100,
        modelId: "gpt-4o",
        outputTokens: 50,
        requestCount: 1,
        trackedSince: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });
});
