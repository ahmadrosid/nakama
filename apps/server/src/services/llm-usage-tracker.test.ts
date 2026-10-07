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

  test("splits usage by agent and by user, and both add up to the org total", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    tracker.record("gpt-4o", 100, 10, {
      orgId: ORG_A,
      profileId: "agent_1",
      userId: "user_1",
    });
    tracker.record("gpt-4o", 200, 20, {
      orgId: ORG_A,
      profileId: "agent_1",
      userId: "user_2",
    });
    // An automation run: an agent, no user.
    tracker.record("gpt-4o", 300, 30, { orgId: ORG_A, profileId: "agent_2" });
    // A workspace call: no agent, no user.
    tracker.record("gpt-4o", 400, 40, { orgId: ORG_A });
    tracker.record("gpt-4o", 9000, 900, {
      orgId: ORG_B,
      profileId: "agent_1",
      userId: "user_1",
    });

    const { agents, users } = await tracker.getStatsByActor(ORG_A);
    const pick = (groups: typeof agents) =>
      Object.fromEntries(
        groups.map((group) => [
          group.id ?? "unattributed",
          [group.requestCount, group.inputTokens, group.outputTokens],
        ])
      );

    expect(pick(agents)).toEqual({
      agent_1: [2, 300, 30],
      agent_2: [1, 300, 30],
      unattributed: [1, 400, 40],
    });
    expect(pick(users)).toEqual({
      unattributed: [2, 700, 70],
      user_1: [1, 100, 10],
      user_2: [1, 200, 20],
    });

    const total = await tracker.getStats(ORG_A);
    for (const groups of [agents, users]) {
      const sum = (key: "requestCount" | "totalTokens" | "estimatedCostUsd") =>
        groups.reduce((acc, group) => acc + group[key], 0);
      expect(sum("requestCount")).toBe(total.requestCount);
      expect(sum("totalTokens")).toBe(total.totalTokens);
      expect(sum("estimatedCostUsd")).toBeCloseTo(total.estimatedCostUsd, 12);
    }
  });

  test("reports the last days oldest first, split by provider, zero-filled", async () => {
    const db = createInMemoryDatabaseAdapter();
    const delta = (tokens: number) => ({
      estimatedCostUsd: tokens / 1000,
      inputTokens: tokens,
      outputTokens: 0,
      requestCount: 1,
    });
    await db.incrementLlmUsageDailyStats(
      ORG_A,
      { day: "2026-10-05", modelId: "gpt-4o", provider: "openai" },
      delta(300)
    );
    await db.incrementLlmUsageDailyStats(
      ORG_A,
      { day: "2026-10-05", modelId: "claude", provider: "anthropic" },
      delta(900)
    );
    await db.incrementLlmUsageDailyStats(
      ORG_A,
      { day: "2026-10-07", modelId: "gpt-4o", provider: "openai" },
      delta(100)
    );
    // Outside the window, and another org.
    await db.incrementLlmUsageDailyStats(
      ORG_A,
      { day: "2026-10-01", modelId: "gpt-4o", provider: "openai" },
      delta(5000)
    );
    await db.incrementLlmUsageDailyStats(
      ORG_B,
      { day: "2026-10-07", modelId: "gpt-4o", provider: "openai" },
      delta(7000)
    );

    const daily = await new LlmUsageTracker(db).getDailyStats(
      ORG_A,
      3,
      new Date("2026-10-07T12:00:00Z")
    );

    expect(daily).toEqual([
      {
        day: "2026-10-05",
        estimatedCostUsd: 1.2,
        providers: [
          { estimatedCostUsd: 0.9, provider: "anthropic", totalTokens: 900 },
          { estimatedCostUsd: 0.3, provider: "openai", totalTokens: 300 },
        ],
        requestCount: 2,
        totalTokens: 1200,
      },
      {
        day: "2026-10-06",
        estimatedCostUsd: 0,
        providers: [],
        requestCount: 0,
        totalTokens: 0,
      },
      {
        day: "2026-10-07",
        estimatedCostUsd: 0.1,
        providers: [
          { estimatedCostUsd: 0.1, provider: "openai", totalTokens: 100 },
        ],
        requestCount: 1,
        totalTokens: 100,
      },
    ]);
  });

  test("records each call under today and its provider", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    tracker.record("gpt-4o", 100, 10, {
      orgId: ORG_A,
      pricingContext: { provider: "openai" },
    });
    tracker.record("gpt-4o", 50, 5, { orgId: ORG_A });

    const today = (await tracker.getDailyStats(ORG_A, 1))[0];
    expect(today).toMatchObject({
      providers: [
        { provider: "openai", totalTokens: 110 },
        { provider: null, totalTokens: 55 },
      ],
      requestCount: 2,
      totalTokens: 165,
    });
    expect(today?.totalTokens).toBe(
      (await tracker.getStats(ORG_A)).totalTokens
    );
  });

  test("returns zero totals without a database", async () => {
    const tracker = new LlmUsageTracker();

    expect(await tracker.getStats(ORG_A)).toMatchObject({
      inputTokens: 0,
      requestCount: 0,
    });
    expect(await tracker.getStatsByModel(ORG_A)).toEqual([]);
    expect(await tracker.getStatsByActor(ORG_A)).toEqual({
      agents: [],
      users: [],
    });
  });
});
