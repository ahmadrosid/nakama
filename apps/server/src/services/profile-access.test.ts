import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "@nakama/db";
import { AutomationService } from "./automation-service";

const ORG_ID = "org_test";

async function seed() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    updatedAt: now,
  });
  const defaultProfile = await seedOrgDefaultProfile(db, ORG_ID);
  const superProfile = await seedOrgSuperBotProfile(db, ORG_ID);
  return { db, defaultId: defaultProfile.id, superId: superProfile.id };
}

const automationInput = {
  description: "a",
  name: "a",
  prompt: "do it",
  trigger: { type: "manual" as const },
};
describe("profile access: binding an automation to Super Bot is admin-only", () => {
  test("member cannot bind an automation to the Super Bot profile", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const attempt = service.create(ORG_ID, automationInput as any, superId, {
      orgRole: "member",
    });

    await expect(attempt).rejects.toBeInstanceOf(NakamaApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  test("admin can bind an automation to the Super Bot profile", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      automationInput as any,
      superId,
      {
        orgRole: "admin",
      }
    );

    expect(automation.profileId).toBe(superId);
  });

  test("omitted access fail-closes Super Bot bind on create", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const attempt = service.create(ORG_ID, automationInput as any, superId);

    await expect(attempt).rejects.toBeInstanceOf(NakamaApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  test("member cannot rebind an automation to Super Bot", async () => {
    const { db, defaultId, superId } = await seed();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      automationInput as any,
      defaultId,
      { orgRole: "member" }
    );

    const attempt = service.update(
      automation.id,
      ORG_ID,
      { profileId: superId },
      { orgRole: "member" }
    );

    await expect(attempt).rejects.toBeInstanceOf(NakamaApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
    expect((await service.get(automation.id, ORG_ID))?.profileId).toBe(
      defaultId
    );
  });

  test("admin can rebind an automation to Super Bot", async () => {
    const { db, defaultId, superId } = await seed();
    const service = new AutomationService(db, {
      getUserTimezone: async () => "UTC",
    });

    const automation = await service.create(
      ORG_ID,
      automationInput as any,
      defaultId,
      { orgRole: "admin" }
    );

    const updated = await service.update(
      automation.id,
      ORG_ID,
      { profileId: superId },
      { orgRole: "admin" }
    );

    expect(updated.profileId).toBe(superId);
  });
});
