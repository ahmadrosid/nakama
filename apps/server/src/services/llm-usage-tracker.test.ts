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

  test("waits for an in-flight record before reloading", async () => {
    const db = createInMemoryDatabaseAdapter();
    const incrementStats = db.incrementLlmUsageStats.bind(db);
    const incrementStatsByModel = db.incrementLlmUsageStatsByModel.bind(db);
    const persistGate = Promise.withResolvers<void>();
    const persistStarted = Promise.withResolvers<void>();
    const persistFinished = Promise.withResolvers<void>();

    db.incrementLlmUsageStats = async (delta, trackedSince) => {
      persistStarted.resolve();
      await persistGate.promise;
      await incrementStats(delta, trackedSince);
    };
    db.incrementLlmUsageStatsByModel = async (modelId, delta, trackedSince) => {
      await incrementStatsByModel(modelId, delta, trackedSince);
      persistFinished.resolve();
    };

    const tracker = await LlmUsageTracker.create(db);
    tracker.record("gpt-4o", 100, 50);
    await persistStarted.promise;

    const reload = tracker.reloadFromDatabase();
    await Promise.resolve();
    persistGate.resolve();
    await Promise.all([reload, persistFinished.promise]);

    expect(tracker.getStats().requestCount).toBe(1);
    expect(tracker.getStatsByModel()).toHaveLength(1);
  });

  test("retries a reload when a record arrives during the database read", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.incrementLlmUsageStats(
      {
        estimatedCostUsd: 0.02,
        inputTokens: 200,
        outputTokens: 100,
        requestCount: 2,
      },
      "2026-06-05T00:00:00.000Z"
    );
    const tracker = await LlmUsageTracker.create(db);
    const getStats = db.getLlmUsageStats.bind(db);
    const readGate = Promise.withResolvers<void>();
    const readStarted = Promise.withResolvers<void>();
    let readCount = 0;
    let pauseNextRead = true;

    db.getLlmUsageStats = async () => {
      readCount += 1;
      const snapshot = await getStats();
      if (pauseNextRead) {
        pauseNextRead = false;
        readStarted.resolve();
        await readGate.promise;
      }
      return snapshot;
    };

    const reload = tracker.reloadFromDatabase();
    await readStarted.promise;
    tracker.record("gpt-4o", 100, 50);
    readGate.resolve();
    await reload;

    expect(tracker.getStats()).toMatchObject({
      inputTokens: 300,
      outputTokens: 150,
      requestCount: 3,
      totalTokens: 450,
    });
    expect(readCount).toBe(2);
    expect(tracker.getStatsByModel()).toMatchObject([
      {
        inputTokens: 100,
        modelId: "gpt-4o",
        outputTokens: 50,
        requestCount: 1,
        totalTokens: 150,
      },
    ]);
  });
});
