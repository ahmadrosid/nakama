import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { LlmUsageTracker } from "./llm-usage-tracker";

const ORG_A = "org_a";
const ORG_B = "org_b";

describe("LlmUsageTracker", () => {
  test("reads back what record persisted for that org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const trackedSince = "2026-06-05T00:00:00.000Z";

    await db.incrementLlmUsageStats(
      ORG_A,
      {
        estimatedCostUsd: 0.12,
        inputTokens: 900,
        outputTokens: 300,
        requestCount: 3,
      },
      trackedSince
    );

    const tracker = new LlmUsageTracker(db);
    tracker.record("gpt-4o", 100, 50, { orgId: ORG_A });

    expect(await tracker.getStats(ORG_A)).toEqual({
      estimatedCostUsd: expect.any(Number),
      inputTokens: 1000,
      outputTokens: 350,
      requestCount: 4,
      totalTokens: 1350,
      trackedSince,
    });

    expect(await tracker.getStatsByModel(ORG_A)).toEqual([
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
  });

  test("keeps one org's ledger out of another org's totals", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    tracker.record("gpt-4o", 100, 50, { orgId: ORG_A });
    tracker.record("gpt-4o", 9000, 4000, { orgId: ORG_B });

    expect(await tracker.getStats(ORG_A)).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      requestCount: 1,
      totalTokens: 150,
    });
    expect(await tracker.getStatsByModel(ORG_A)).toMatchObject([
      { inputTokens: 100, modelId: "gpt-4o", requestCount: 1 },
    ]);
    expect(await tracker.getStats(ORG_B)).toMatchObject({
      inputTokens: 9000,
      outputTokens: 4000,
      requestCount: 1,
      totalTokens: 13_000,
    });
    expect(await tracker.getStatsByModel(ORG_B)).toMatchObject([
      { inputTokens: 9000, modelId: "gpt-4o", requestCount: 1 },
    ]);
  });

  test("reports zero for an org that never recorded usage", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    tracker.record("gpt-4o", 100, 50, { orgId: ORG_A });

    expect(await tracker.getStats(ORG_B)).toMatchObject({
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
      totalTokens: 0,
    });
    expect(await tracker.getStatsByModel(ORG_B)).toEqual([]);
  });

  test("accumulates concurrent records for the same org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    for (let index = 0; index < 5; index += 1) {
      tracker.record("gpt-4o", 10, 5, { orgId: ORG_A });
    }

    expect(await tracker.getStats(ORG_A)).toMatchObject({
      inputTokens: 50,
      outputTokens: 25,
      requestCount: 5,
      totalTokens: 75,
    });
  });

  test("returns zero totals without a database", async () => {
    const tracker = new LlmUsageTracker();

    expect(await tracker.getStats(ORG_A)).toMatchObject({
      inputTokens: 0,
      requestCount: 0,
    });
    expect(await tracker.getStatsByModel(ORG_A)).toEqual([]);
  });
});
