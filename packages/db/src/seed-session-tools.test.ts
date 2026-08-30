import { describe, expect, test } from "bun:test";
import {
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./index";
import { ensureSessionToolDefinitions } from "./org-profiles";
import { removeUnsupportedTools, seedDatabase } from "./seed";

const SESSION_TOOL_IDS = [
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
];

describe("session tool definitions", () => {
  test("upserts both rows with the session handler type", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureSessionToolDefinitions(db);
    await ensureSessionToolDefinitions(db);

    const list = await db.getTool(LIST_PROFILE_SESSIONS_TOOL_ID);
    const read = await db.getTool(READ_PROFILE_SESSION_TOOL_ID);

    expect(list?.name).toBe("list_profile_sessions");
    expect(read?.name).toBe("read_profile_session");
    expect(list?.handlerType).toBe("session");
    expect(read?.handlerType).toBe("session");
  });

  test("survives removeUnsupportedTools, which deletes unlisted handler types", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureSessionToolDefinitions(db);
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "made up",
      handlerConfig: {},
      handlerType: "not_a_real_handler",
      id: "tool_invented",
      name: "invented",
      updatedAt: new Date().toISOString(),
    });

    await removeUnsupportedTools(db);

    expect(await db.getTool("tool_invented")).toBeNull();
    for (const id of SESSION_TOOL_IDS) {
      expect(await db.getTool(id)).not.toBeNull();
    }
  });

  test("seeds the rows without assigning them to an ordinary profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "profile_ordinary",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Ordinary",
      orgId: "org_a",
      systemPrompt: "You are helpful.",
      updatedAt: now,
    });

    await seedDatabase(db);

    for (const id of SESSION_TOOL_IDS) {
      expect(await db.getTool(id)).not.toBeNull();
    }

    const assigned = await db.listToolsForProfile("profile_ordinary");
    const names = assigned.map((tool) => tool.name);

    expect(names).not.toContain("list_profile_sessions");
    expect(names).not.toContain("read_profile_session");
  });

  test("assigns both to the Super Bot profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });

    await seedDatabase(db);

    const superProfile = (await db.listProfilesForOrg("org_a")).find(
      (candidate) => candidate.isSuper
    );
    expect(superProfile).toBeDefined();

    const names = (await db.listToolsForProfile(superProfile?.id ?? "")).map(
      (tool) => tool.name
    );

    expect(names).toContain("list_profile_sessions");
    expect(names).toContain("read_profile_session");
  });

  test("re-assigns both to Super Bot on the next boot after an unassign", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });
    await seedDatabase(db);

    const superProfile = (await db.listProfilesForOrg("org_a")).find(
      (candidate) => candidate.isSuper
    );
    const profileId = superProfile?.id ?? "";

    for (const id of SESSION_TOOL_IDS) {
      await db.unassignToolFromProfile(profileId, id);
    }

    const afterUnassign = (await db.listToolsForProfile(profileId)).map(
      (tool) => tool.name
    );
    expect(afterUnassign).not.toContain("list_profile_sessions");

    // Second boot: seedOrgSuperBotProfile takes the existing-profile branch.
    await seedDatabase(db);

    const afterReboot = (await db.listToolsForProfile(profileId)).map(
      (tool) => tool.name
    );
    expect(afterReboot).toContain("list_profile_sessions");
    expect(afterReboot).toContain("read_profile_session");
  });
});
