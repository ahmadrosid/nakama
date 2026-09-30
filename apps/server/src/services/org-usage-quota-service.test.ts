import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { OrgUsageQuotaService } from "./org-usage-quota-service";

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
        existingTokens: 0,
        existingTurns: 0,
        month: now.slice(0, 7),
        orgId: "org_atomic",
        reservedTokens: 0,
        updatedAt: now,
      }),
      db.tryReserveMonthlyLlmQuota({
        existingTokens: 0,
        existingTurns: 0,
        month: now.slice(0, 7),
        orgId: "org_atomic",
        reservedTokens: 0,
        updatedAt: now,
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
    ).resolves.toBeUndefined();
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

  test("a released reservation does not consume the monthly turn limit", async () => {
    const db = createInMemoryDatabaseAdapter();
    const orgId = "org_release";
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: orgId,
      monthlyLlmTurnLimit: 2,
      name: "Release organization",
      slug: "release-organization",
      updatedAt: now,
    });

    const quota = new OrgUsageQuotaService(db);

    // Two turns that reserve and then fail. Neither spends anything, so the
    // limit must still allow a real third turn afterwards.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const release = await quota.reserveLlmTurn(orgId);
      await release();
    }

    const release = await quota.reserveLlmTurn(orgId);
    expect(release).toBeFunction();
    await release();
  });

  test("releasing the same reservation twice only returns it once", async () => {
    const db = createInMemoryDatabaseAdapter();
    const orgId = "org_double_release";
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: orgId,
      monthlyLlmTurnLimit: 1,
      name: "Double release organization",
      slug: "double-release-organization",
      updatedAt: now,
    });

    const quota = new OrgUsageQuotaService(db);
    const release = await quota.reserveLlmTurn(orgId);
    await release();
    await release();

    // A turn limit of 1 is still available, so a double release did not drive
    // the reservation counter negative and lock the org out.
    const second = await quota.reserveLlmTurn(orgId);
    expect(second).toBeFunction();
  });
});
