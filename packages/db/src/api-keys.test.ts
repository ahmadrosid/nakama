import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";

describe("API keys", () => {
  test("stores, lists, resolves, and revokes org-scoped keys", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      createdAt: now,
      id: "org_api",
      name: "API Org",
      slug: "api-org",
      updatedAt: now,
    });
    await db.createUser({
      createdAt: now,
      email: "owner@example.com",
      id: "user_owner",
      passwordHash: "unused",
      updatedAt: now,
    });

    await db.createApiKey({
      createdAt: now,
      createdByUserId: "user_owner",
      environment: "live",
      expiresAt: null,
      id: "key_api",
      keyPrefix: "nk_live_123456789012",
      lastUsedAt: null,
      name: "Production app",
      orgId: "org_api",
      revokedAt: null,
      secretHash: "hash",
    });

    await expect(
      db.getApiKeyByPrefix("nk_live_123456789012")
    ).resolves.toMatchObject({
      id: "key_api",
      orgId: "org_api",
      secretHash: "hash",
    });
    await expect(db.listApiKeysForOrg("org_api")).resolves.toHaveLength(1);
    await expect(db.revokeApiKey("key_api", now)).resolves.toBe(true);
    await expect(
      db.getApiKeyByPrefix("nk_live_123456789012")
    ).resolves.toMatchObject({
      revokedAt: now,
    });
  });
});
