import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";

describe("profile ACP settings", () => {
  test("keeps the chosen agent settings across a save and read", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      acpSettings: { effort: "high", model: "sonnet" },
      createdAt: now,
      id: "profile_settings",
      isSuper: false,
      model: null,
      name: "Settings",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });

    const saved = await db.getProfileForOrg("profile_settings", "org_a");
    expect(saved?.acpSettings).toEqual({ effort: "high", model: "sonnet" });
  });

  test("reads a profile without saved settings as null", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_no_settings",
      isSuper: false,
      model: null,
      name: "Plain",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });

    const saved = await db.getProfileForOrg("profile_no_settings", "org_a");
    expect(saved?.acpSettings).toBeNull();
  });
});
