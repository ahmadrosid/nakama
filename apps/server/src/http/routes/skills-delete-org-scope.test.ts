import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { SkillsService } from "../../services/skills-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { createPlatformAdminUser } from "../test-org-helpers";
import { loginUserSession } from "../test-session-helpers";

setupTestConfigDir("nakama-skills-delete-org-scope-test-");

const BASE = "http://localhost:4310";

const VALID_SKILL = `---
name: github-weather
description: Get weather from a public GitHub skill.
---

Call the weather tool.
`;

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const skillsService = new SkillsService(databaseAdapter);

  return {
    ...createMinimalHonoApp({
      agent: {
        deleteSkill: (skillId: string, orgId: string) =>
          skillsService.deleteSkill(skillId, orgId),
      },
      databaseAdapter,
    }),
    databaseAdapter,
    skillsService,
  };
}

describe("DELETE /v1/skills/:skillId", () => {
  async function seedOrgASkill() {
    const { app, authService, databaseAdapter, skillsService } = createApp();
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

    await skillsService.createAndAssignRawSkillToProfile(
      "org_a",
      "profile_a",
      VALID_SKILL
    );

    const skill = await databaseAdapter.getSkillByName(
      "github-weather",
      "org_a"
    );

    const session = await loginUserSession(
      app,
      "platform@example.com",
      "password123"
    );

    const deleteAs = (orgId: string) =>
      app.fetch(
        new Request(`${BASE}/v1/skills/${encodeURIComponent(skill!.id)}`, {
          headers: session.headers(
            { "X-CSRF-Token": session.csrfToken },
            orgId
          ),
          method: "DELETE",
        })
      );

    return { databaseAdapter, deleteAs, sourcePath: skill!.sourcePath };
  }

  test("a platform admin in another org gets 404 and the skill stays", async () => {
    const { databaseAdapter, deleteAs, sourcePath } = await seedOrgASkill();

    const response = await deleteAs("org_b");

    expect(response.status).toBe(404);
    expect(
      await databaseAdapter.getSkillByName("github-weather", "org_a")
    ).not.toBeNull();
    expect((await stat(sourcePath)).isDirectory()).toBe(true);
  });

  test("the owning org deletes its skill", async () => {
    const { databaseAdapter, deleteAs } = await seedOrgASkill();

    const response = await deleteAs("org_a");

    expect(response.status).toBe(204);
    expect(
      await databaseAdapter.getSkillByName("github-weather", "org_a")
    ).toBeNull();
  });
});
