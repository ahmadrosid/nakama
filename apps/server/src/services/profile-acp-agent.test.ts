import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "./profile-service";

const ORG_ID = "org_acp_agent";

const PROFILE_ID = "profile_acp_agent";

async function seedProfile() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertProfile({
    createdAt: now,
    id: PROFILE_ID,
    isSuper: false,
    model: null,
    name: "Coder",
    orgId: ORG_ID,
    systemPrompt: "",
    updatedAt: now,
  });

  return { db, service: new ProfileService(db) };
}

describe("profile ACP agent", () => {
  test("stores the agent command and args on the profile", async () => {
    const { db, service } = await seedProfile();

    await service.updateProfile(ORG_ID, PROFILE_ID, {
      acpAgent: {
        args: ["-y", "@agentclientprotocol/codex-acp@2.1.1"],
        command: "npx",
      },
    });

    const saved = await db.getProfileForOrg(PROFILE_ID, ORG_ID);
    expect(saved?.acpAgent).toEqual({
      args: ["-y", "@agentclientprotocol/codex-acp@2.1.1"],
      command: "npx",
    });
  });

  test("clears the agent when null is sent", async () => {
    const { db, service } = await seedProfile();

    await service.updateProfile(ORG_ID, PROFILE_ID, {
      acpAgent: { args: [], command: "codex-acp" },
    });
    await service.updateProfile(ORG_ID, PROFILE_ID, { acpAgent: null });

    const saved = await db.getProfileForOrg(PROFILE_ID, ORG_ID);
    expect(saved?.acpAgent).toBeNull();
  });

  test("rejects a blank command before saving", async () => {
    const { db, service } = await seedProfile();

    await expect(
      service.updateProfile(ORG_ID, PROFILE_ID, {
        acpAgent: { args: [], command: "   " },
      })
    ).rejects.toThrow("ACP agent command is required.");

    const saved = await db.getProfileForOrg(PROFILE_ID, ORG_ID);
    expect(saved?.acpAgent).toBeNull();
  });

  test("keeps the agent when the update does not mention it", async () => {
    const { db, service } = await seedProfile();

    await service.updateProfile(ORG_ID, PROFILE_ID, {
      acpAgent: { args: [], command: "codex-acp" },
    });
    await service.updateProfile(ORG_ID, PROFILE_ID, { name: "Renamed" });

    const saved = await db.getProfileForOrg(PROFILE_ID, ORG_ID);
    expect(saved?.acpAgent).toEqual({ args: [], command: "codex-acp" });
  });
});
