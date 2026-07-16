import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "@nakama/db";
import { AutomationService } from "./automation-service";
import { TaskService } from "./task-service";

const ORG_ID = "org_test";

async function seed() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  await db.upsertOrganization({
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });
  const defaultProfile = await seedOrgDefaultProfile(db, ORG_ID);
  const superProfile = await seedOrgSuperBotProfile(db, ORG_ID);
  return { db, superId: superProfile.id, defaultId: defaultProfile.id };
}

const automationInput = {
  name: "a",
  description: "a",
  prompt: "do it",
  trigger: { type: "manual" as const },
};
const taskInput = { title: "t", prompt: "do it", status: "backlog" as const };

describe("profile access: binding an automation/task to Super Bot is admin-only", () => {
  test("member cannot bind an automation to the Super Bot profile", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, { getUserTimezone: async () => "UTC" });

    const attempt = service.create(ORG_ID, automationInput as any, superId, {
      orgRole: "member",
    });

    await expect(attempt).rejects.toBeInstanceOf(NakamaApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  test("admin can bind an automation to the Super Bot profile", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, { getUserTimezone: async () => "UTC" });

    const automation = await service.create(ORG_ID, automationInput as any, superId, {
      orgRole: "admin",
    });

    expect(automation.profileId).toBe(superId);
  });

  test("member cannot bind a task to the Super Bot profile", async () => {
    const { db, superId } = await seed();
    const service = new TaskService(db);

    const attempt = service.create(ORG_ID, taskInput as any, superId, { orgRole: "member" });

    await expect(attempt).rejects.toBeInstanceOf(NakamaApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  test("no access context (internal/agent-tool caller) is not gated", async () => {
    const { db, superId } = await seed();
    const service = new AutomationService(db, { getUserTimezone: async () => "UTC" });

    // Agent-tool path passes the session's own (already access-checked) profile
    // with no role context; enforcement is opt-in, so this must still succeed.
    const automation = await service.create(ORG_ID, automationInput as any, superId);

    expect(automation.profileId).toBe(superId);
  });
});
