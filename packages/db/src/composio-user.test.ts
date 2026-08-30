import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";

describe("composio user connections", () => {
  test("upsert and fetch user connection by toolkit", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      cachedTools: [],
      createdAt: now,
      displayName: "Gmail",
      id: "ctk_gmail",
      lastError: null,
      orgId: "org_a",
      status: "enabled",
      toolkitSlug: "gmail",
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      connectedAccountId: "ca_1",
      createdAt: now,
      id: "cuc_1",
      lastError: null,
      oauthStateHash: null,
      orgId: "org_a",
      sessionIdEnc: null,
      status: "connected",
      toolkitId: "ctk_gmail",
      updatedAt: now,
      userId: "usr_a",
    });

    const connection = await db.getComposioUserConnection("usr_a", "ctk_gmail");
    expect(connection?.status).toBe("connected");

    const listed = await db.listComposioUserConnectionsForUser(
      "org_a",
      "usr_a"
    );
    expect(listed).toHaveLength(1);
  });

  test("two users can connect the same org toolkit independently", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      cachedTools: [],
      createdAt: now,
      displayName: "Gmail",
      id: "ctk_gmail",
      lastError: null,
      orgId: "org_a",
      status: "enabled",
      toolkitSlug: "gmail",
      updatedAt: now,
    });

    await db.upsertComposioUserConnection({
      connectedAccountId: "ca_a",
      createdAt: now,
      id: "cuc_a",
      lastError: null,
      oauthStateHash: null,
      orgId: "org_a",
      sessionIdEnc: null,
      status: "connected",
      toolkitId: "ctk_gmail",
      updatedAt: now,
      userId: "usr_a",
    });

    await db.upsertComposioUserConnection({
      connectedAccountId: "ca_b",
      createdAt: now,
      id: "cuc_b",
      lastError: null,
      oauthStateHash: null,
      orgId: "org_a",
      sessionIdEnc: null,
      status: "connected",
      toolkitId: "ctk_gmail",
      updatedAt: now,
      userId: "usr_b",
    });

    expect(
      await db.getComposioUserConnection("usr_a", "ctk_gmail")
    ).not.toBeNull();
    expect(
      await db.getComposioUserConnection("usr_b", "ctk_gmail")
    ).not.toBeNull();
  });

  test("listComposioUserConnectionsForUser filters by org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioUserConnection({
      connectedAccountId: null,
      createdAt: now,
      id: "cuc_a",
      lastError: null,
      oauthStateHash: null,
      orgId: "org_a",
      sessionIdEnc: null,
      status: "connected",
      toolkitId: "ctk_1",
      updatedAt: now,
      userId: "usr_a",
    });

    await db.upsertComposioUserConnection({
      connectedAccountId: null,
      createdAt: now,
      id: "cuc_b",
      lastError: null,
      oauthStateHash: null,
      orgId: "org_b",
      sessionIdEnc: null,
      status: "connected",
      toolkitId: "ctk_2",
      updatedAt: now,
      userId: "usr_a",
    });

    const orgA = await db.listComposioUserConnectionsForUser("org_a", "usr_a");
    expect(orgA).toHaveLength(1);
    expect(orgA[0]?.id).toBe("cuc_a");
  });
});
