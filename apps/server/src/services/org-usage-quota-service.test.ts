import { describe, expect, test } from "bun:test";
import { createAgentChatSession } from "@nakama/agent";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { OrgUsageQuotaService } from "./org-usage-quota-service";

async function tokenLimitedOrg(orgId: string, now?: () => Date) {
  const db = createInMemoryDatabaseAdapter();
  const createdAt = new Date().toISOString();
  await db.upsertOrganization({
    createdAt,
    id: orgId,
    monthlyLlmTokenLimit: 500_000,
    name: orgId,
    slug: orgId,
    updatedAt: createdAt,
  });

  return { db, quota: new OrgUsageQuotaService(db, now) };
}

const quotaReached = { status: 429 };

describe("OrgUsageQuotaService", () => {
  test("atomically reserves a limited monthly turn exactly once", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_atomic",
      monthlyLlmTurnLimit: 1,
      name: "Atomic organization",
      slug: "atomic-organization",
      updatedAt: now,
    });

    const reservations = await Promise.all([
      db.tryReserveMonthlyLlmQuota({
        createdAt: now,
        existingTokens: 0,
        existingTurns: 0,
        orgId: "org_atomic",
        reservationId: "reservation_1",
        reservedTokens: 0,
      }),
      db.tryReserveMonthlyLlmQuota({
        createdAt: now,
        existingTokens: 0,
        existingTurns: 0,
        orgId: "org_atomic",
        reservationId: "reservation_2",
        reservedTokens: 0,
      }),
    ]);

    expect(reservations.filter(Boolean)).toHaveLength(1);
  });

  test("does not apply one organization's exhausted quota to another", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_limited",
      monthlyLlmTurnLimit: 1,
      name: "Limited organization",
      slug: "limited-organization",
      updatedAt: now,
    });
    await db.upsertOrganization({
      createdAt: now,
      id: "org_unlimited",
      monthlyLlmTurnLimit: 1,
      name: "Independent organization",
      slug: "independent-organization",
      updatedAt: now,
    });
    await db.incrementLlmTurnUsage("org_limited", {
      estimated: false,
      inputTokens: 1,
      optimized: false,
      outputTokens: 1,
    });

    const quotas = new OrgUsageQuotaService(db);
    await expect(
      quotas.assertCanStartLlmTurn("org_limited")
    ).rejects.toMatchObject({
      status: 429,
    });
    await expect(
      quotas.assertCanStartLlmTurn("org_unlimited")
    ).resolves.toBeFunction();
  });

  test("reports warning before an enabled turn limit is reached", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_warning",
      monthlyLlmTurnLimit: 10,
      monthlyLlmWarningPercent: 80,
      name: "Warning organization",
      slug: "warning-organization",
      updatedAt: now,
    });

    for (let turn = 0; turn < 8; turn += 1) {
      await db.incrementLlmTurnUsage("org_warning", {
        estimated: false,
        inputTokens: 1,
        optimized: false,
        outputTokens: 1,
      });
    }

    const quota = new OrgUsageQuotaService(db);
    await expect(quota.getStatus("org_warning")).resolves.toMatchObject({
      status: "warning",
      turns: 8,
    });
  });

  test("blocks a new turn when monthly token usage reaches the organization limit", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_token_limited",
      monthlyLlmTokenLimit: 100,
      name: "Token limited organization",
      slug: "token-limited-organization",
      updatedAt: now,
    });
    await db.incrementLlmTurnUsage("org_token_limited", {
      estimated: false,
      inputTokens: 75,
      optimized: false,
      outputTokens: 25,
    });

    const quota = new OrgUsageQuotaService(db);
    await expect(
      quota.assertCanStartLlmTurn("org_token_limited")
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  test("blocks a new turn after the organization reaches its monthly turn limit", async () => {
    const db = createInMemoryDatabaseAdapter();
    const orgId = "org_limited";
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: orgId,
      monthlyLlmTurnLimit: 2,
      name: "Limited organization",
      slug: "limited-organization",
      updatedAt: now,
    });
    await db.incrementLlmTurnUsage(orgId, {
      estimated: false,
      inputTokens: 100,
      optimized: false,
      outputTokens: 50,
    });
    await db.incrementLlmTurnUsage(orgId, {
      estimated: false,
      inputTokens: 100,
      optimized: false,
      outputTokens: 50,
    });

    const quota = new OrgUsageQuotaService(db);

    await expect(quota.assertCanStartLlmTurn(orgId)).rejects.toMatchObject({
      status: 429,
    });
  });

  test("a call that ends without usage gives its reservation back", async () => {
    const { quota } = await tokenLimitedOrg("org_release");

    for (let call = 0; call < 3; call += 1) {
      const release = await quota.assertCanStartLlmTurn("org_release", 200_000);
      await release();
    }
  });

  test("provider errors do not exhaust the organization quota", async () => {
    const { quota } = await tokenLimitedOrg("org_failing");

    const session = createAgentChatSession(
      {
        provider: {
          generateChat: () => Promise.reject(new Error("provider exploded")),
          generateText: () => Promise.resolve({ content: "" }),
          name: "openai",
          streamChat: () => Promise.reject(new Error("provider exploded")),
        },
        tools: [],
      },
      {
        toolContext: {
          assertCanStartLlmTurn: (reservedTokens) =>
            quota.assertCanStartLlmTurn("org_failing", reservedTokens),
        },
      }
    );

    for (let turn = 0; turn < 3; turn += 1) {
      await expect(session.send("hi")).rejects.toThrow("provider exploded");
    }
  });

  test("releasing one reservation twice does not free another", async () => {
    const { quota } = await tokenLimitedOrg("org_twice");
    const release = await quota.assertCanStartLlmTurn("org_twice", 200_000);
    await quota.assertCanStartLlmTurn("org_twice", 200_000);

    await release();
    await release();

    await expect(
      quota.assertCanStartLlmTurn("org_twice", 300_001)
    ).rejects.toMatchObject(quotaReached);
    await quota.assertCanStartLlmTurn("org_twice", 300_000);
  });

  test("repeated releases never leave more than the limit available", async () => {
    const { quota } = await tokenLimitedOrg("org_floor");
    const release = await quota.assertCanStartLlmTurn("org_floor", 200_000);

    await release();
    await release();
    await release();

    await expect(
      quota.assertCanStartLlmTurn("org_floor", 500_001)
    ).rejects.toMatchObject(quotaReached);
    await quota.assertCanStartLlmTurn("org_floor", 500_000);
  });

  test("a call that records usage and releases is charged once", async () => {
    const { db, quota } = await tokenLimitedOrg("org_charged");
    const release = await quota.assertCanStartLlmTurn("org_charged", 200_000);
    await db.incrementLlmTurnUsage("org_charged", {
      estimated: false,
      inputTokens: 60_000,
      optimized: false,
      outputTokens: 40_000,
    });
    await release();

    await expect(
      quota.assertCanStartLlmTurn("org_charged", 400_001)
    ).rejects.toMatchObject(quotaReached);
    await quota.assertCanStartLlmTurn("org_charged", 400_000);
  });

  test("a release scoped to another organization frees nothing", async () => {
    const { db, quota } = await tokenLimitedOrg("org_owner");
    await db.tryReserveMonthlyLlmQuota({
      createdAt: new Date().toISOString(),
      existingTokens: 0,
      existingTurns: 0,
      orgId: "org_owner",
      reservationId: "reservation_owner",
      reservedTokens: 400_000,
    });

    await db.releaseMonthlyLlmQuota("org_other", "reservation_owner");

    await expect(
      quota.assertCanStartLlmTurn("org_owner", 200_000)
    ).rejects.toMatchObject(quotaReached);
  });

  test("a hold left by a call that never released stops counting after an hour", async () => {
    let now = new Date("2026-03-01T10:00:00.000Z");
    const { quota } = await tokenLimitedOrg("org_stale", () => now);
    await quota.assertCanStartLlmTurn("org_stale", 400_000);

    now = new Date("2026-03-01T10:59:00.000Z");
    await expect(
      quota.assertCanStartLlmTurn("org_stale", 200_000)
    ).rejects.toMatchObject(quotaReached);

    now = new Date("2026-03-01T11:00:01.000Z");
    await quota.assertCanStartLlmTurn("org_stale", 200_000);
  });
});
