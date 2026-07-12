import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";

describe("composio org isolation", () => {
  test("listComposioToolkitsForOrg returns only matching org rows", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      id: "ctk_a",
      orgId: "org_a",
      toolkitSlug: "gmail",
      displayName: "Gmail",
      status: "connected",
      connectedAccountId: "ca_1",
      sessionIdEnc: null,
      oauthStateHash: null,
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertComposioToolkit({
      id: "ctk_b",
      orgId: "org_b",
      toolkitSlug: "gmail",
      displayName: "Gmail",
      status: "enabled",
      connectedAccountId: null,
      sessionIdEnc: null,
      oauthStateHash: null,
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    const orgARows = await db.listComposioToolkitsForOrg("org_a");
    expect(orgARows).toHaveLength(1);
    expect(orgARows[0]?.id).toBe("ctk_a");
  });

  test("replaceProfileComposioToolkits stores action allowlists", async () => {
    const db = createInMemoryDatabaseAdapter();

    await db.replaceProfileComposioToolkits("profile_1", [
      {
        profileId: "profile_1",
        toolkitId: "ctk_a",
        allowedActions: ["GMAIL_SEND_EMAIL"],
      },
    ]);

    const assignments = await db.listProfileComposioToolkits("profile_1");
    expect(assignments).toEqual([
      {
        profileId: "profile_1",
        toolkitId: "ctk_a",
        allowedActions: ["GMAIL_SEND_EMAIL"],
      },
    ]);
  });
});
