import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";

describe("composio user connections", () => {
  test("upsert and fetch user connection by toolkit", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      id: "ctk_gmail",
      orgId: "org_a",
      toolkitSlug: "gmail",
      displayName: "Gmail",
      status: "enabled",
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      id: "cuc_1",
      orgId: "org_a",
      userId: "usr_a",
      toolkitId: "ctk_gmail",
      status: "connected",
      connectedAccountId: "ca_1",
      sessionIdEnc: null,
      oauthStateHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    const connection = await db.getComposioUserConnection("usr_a", "ctk_gmail");
    expect(connection?.status).toBe("connected");

    const listed = await db.listComposioUserConnectionsForUser("org_a", "usr_a");
    expect(listed).toHaveLength(1);
  });

  test("two users can connect the same org toolkit independently", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      id: "ctk_gmail",
      orgId: "org_a",
      toolkitSlug: "gmail",
      displayName: "Gmail",
      status: "enabled",
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      id: "cuc_a",
      orgId: "org_a",
      userId: "usr_a",
      toolkitId: "ctk_gmail",
      status: "connected",
      connectedAccountId: "ca_a",
      sessionIdEnc: null,
      oauthStateHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      id: "cuc_b",
      orgId: "org_a",
      userId: "usr_b",
      toolkitId: "ctk_gmail",
      status: "connected",
      connectedAccountId: "ca_b",
      sessionIdEnc: null,
      oauthStateHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(await db.getComposioUserConnection("usr_a", "ctk_gmail")).not.toBeNull();
    expect(await db.getComposioUserConnection("usr_b", "ctk_gmail")).not.toBeNull();
  });

  test("listComposioUserConnectionsForUser filters by org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioUserConnection({
      id: "cuc_a",
      orgId: "org_a",
      userId: "usr_a",
      toolkitId: "ctk_1",
      status: "connected",
      connectedAccountId: null,
      sessionIdEnc: null,
      oauthStateHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      id: "cuc_b",
      orgId: "org_b",
      userId: "usr_a",
      toolkitId: "ctk_2",
      status: "connected",
      connectedAccountId: null,
      sessionIdEnc: null,
      oauthStateHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    const orgA = await db.listComposioUserConnectionsForUser("org_a", "usr_a");
    expect(orgA).toHaveLength(1);
    expect(orgA[0]?.id).toBe("cuc_a");
  });
});
