import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";

describe("composio org isolation", () => {
  test("listComposioToolkitsForOrg returns only matching org rows", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertComposioToolkit({
      cachedTools: [],
      createdAt: now,
      displayName: "Gmail",
      id: "ctk_a",
      lastError: null,
      orgId: "org_a",
      status: "enabled",
      toolkitSlug: "gmail",
      updatedAt: now,
    });

    await db.upsertComposioToolkit({
      cachedTools: [],
      createdAt: now,
      displayName: "Gmail",
      id: "ctk_b",
      lastError: null,
      orgId: "org_b",
      status: "enabled",
      toolkitSlug: "gmail",
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
        allowedActions: ["GMAIL_SEND_EMAIL"],
        profileId: "profile_1",
        toolkitId: "ctk_a",
      },
    ]);

    const assignments = await db.listProfileComposioToolkits("profile_1");
    expect(assignments).toEqual([
      {
        allowedActions: ["GMAIL_SEND_EMAIL"],
        profileId: "profile_1",
        toolkitId: "ctk_a",
      },
    ]);
  });
});
