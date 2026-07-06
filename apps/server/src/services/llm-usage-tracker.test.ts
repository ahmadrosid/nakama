import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { LlmUsageTracker } from "./llm-usage-tracker";

describe("LlmUsageTracker", () => {
  test("loads persisted stats and increments them on record", async () => {
    const db = createInMemoryDatabaseAdapter();
    const trackedSince = "2026-06-05T00:00:00.000Z";

    await db.incrementLlmUsageStats(
      {
        requestCount: 3,
        inputTokens: 900,
        outputTokens: 300,
        estimatedCostUsd: 0.12,
      },
      trackedSince,
    );

    const tracker = await LlmUsageTracker.create(db);
    tracker.record("gpt-4o", 100, 50);

    expect(tracker.getStats()).toEqual({
      requestCount: 4,
      inputTokens: 1000,
      outputTokens: 350,
      totalTokens: 1350,
      estimatedCostUsd: expect.any(Number),
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
        modelId: "gpt-4o",
        requestCount: 1,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: expect.any(Number),
        trackedSince: expect.any(String),
      },
    ]);
    expect(persistedByModel).toEqual([
      {
        modelId: "gpt-4o",
        requestCount: 1,
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: expect.any(Number),
        trackedSince: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });
});
