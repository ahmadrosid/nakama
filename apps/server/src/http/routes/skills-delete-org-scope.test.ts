import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { SkillsService } from "../../services/skills-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { createPlatformAdminUser } from "../test-org-helpers";
import { loginUserSession } from "../test-session-helpers";

setupTestConfigDir("nakama-skills-delete-org-scope-test-");

const BASE = "http://localhost:4310";

const SKILL = `---
name: deploy-notes
description: Deploy notes for the owning org.
---

Run the deploy steps.
`;

async function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const skillsService = new SkillsService(databaseAdapter);

  const { app, authService } = createMinimalHonoApp({
    agent: {
      deleteSkill: (skillId: string, orgId?: string) =>
        skillsService.deleteSkill(skillId, orgId),
      getSkill: (skillId: string, orgId?: string) =>
        skillsService.getSkill(skillId, orgId),
    },
    databaseAdapter,
  });

  const now = new Date().toISOString();

  for (const orgId of ["org_a", "org_b"]) {
    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: orgId,
      name: orgId,
      slug: orgId,
      updatedAt: now,
    });
  }

  await createPlatformAdminUser(databaseAdapter, authService);

  return { app, databaseAdapter, skillsService };
}

async function deleteSkill(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  session: Awaited<ReturnType<typeof loginUserSession>>,
  skillId: string,
  orgId: string
) {
  return app.fetch(
    new Request(`${BASE}/v1/skills/${encodeURIComponent(skillId)}`, {
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }, orgId),
      method: "DELETE",
    })
  );
}

describe("DELETE /v1/skills/:skillId", () => {
  test("a platform admin in another org gets 404 and the skill stays", async () => {
    const { app, databaseAdapter, skillsService } = await createApp();

    await skillsService.createAndAssignRawSkillToProfile(
      "org_a",
      "profile_a",
      SKILL
    );

    const orgARow = await databaseAdapter.getSkillByName(
      "deploy-notes",
      "org_a"
    );

    const session = await loginUserSession(
      app,
      "platform@example.com",
      "password123"
    );

    const response = await deleteSkill(app, session, orgARow!.id, "org_b");

    expect(response.status).toBe(404);
    expect(
      await databaseAdapter.getSkillByName("deploy-notes", "org_a")
    ).not.toBeNull();
  });

  test("the owning org deletes its skill", async () => {
    const { app, databaseAdapter, skillsService } = await createApp();

    await skillsService.createAndAssignRawSkillToProfile(
      "org_a",
      "profile_a",
      SKILL
    );

    const orgARow = await databaseAdapter.getSkillByName(
      "deploy-notes",
      "org_a"
    );

    const session = await loginUserSession(
      app,
      "platform@example.com",
      "password123"
    );

    const response = await deleteSkill(app, session, orgARow!.id, "org_a");

    expect(response.status).toBe(204);
    expect(
      await databaseAdapter.getSkillByName("deploy-notes", "org_a")
    ).toBeNull();
  });
});
