import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { SkillProposalService } from "../../services/skill-proposal-service";
import { SkillSuggestionService } from "../../services/skill-suggestion-service";
import { SkillsService } from "../../services/skills-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-skill-suggestions-routes-test-");

const sampleSkillMarkdown = `---
name: deploy-notes
description: Notes about deploy process.
---

Run the deploy checklist before shipping.
`;

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const skillsService = new SkillsService(databaseAdapter);

  const skillProposalService = new SkillProposalService(
    databaseAdapter,
    skillsService
  );

  const skillSuggestionService = new SkillSuggestionService(
    databaseAdapter,
    skillsService,
    skillProposalService
  );

  return {
    ...createMinimalHonoApp({
      agent: {
        getProfileAccess: async (orgId: string, profileId: string) => {
          const profile = await databaseAdapter.getProfileForOrg(
            profileId,
            orgId
          );

          return profile
            ? {
                isSuper: profile.isSuper,
                ownerUserId: profile.ownerUserId ?? null,
                sharedWithTeam: profile.sharedWithTeam,
              }
            : null;
        },
      },
      databaseAdapter,
      skillProposalService,
      skillSuggestionService,
    }),
    skillProposalService,
    skillSuggestionService,
    skillsService,
  };
}

const BASE = "http://localhost:4310";

describe("skill suggestion routes (v1)", () => {
  test("admin can list and apply suggestions; member can list", async () => {
    const { app, databaseAdapter, skillSuggestionService } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );

    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId,
    });

    const listResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions?status=pending`, {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(listResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const listBody = (await listResp.json()) as {
      suggestions: { id: string; skillName: string }[];
    };

    expect(listBody.suggestions).toHaveLength(1);
    expect(listBody.suggestions[0]?.skillName).toBe("deploy-notes");

    const applyResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-suggestions/${created.id}/apply`,
        {
          headers: adminSession.headers(
            { "X-CSRF-Token": adminSession.csrfToken },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(applyResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const applyBody = (await applyResp.json()) as {
      outcome: string;
      suggestion: { status: string };
    };

    expect(applyBody.outcome).toBe("applied");
    expect(applyBody.suggestion.status).toBe("applied");

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@org.com",
          name: "Member",
          role: "member",
        }),
        headers: adminSession.headers(
          { "X-CSRF-Token": adminSession.csrfToken },
          orgId
        ),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const secondaryMemberProvisioned = (await memberResp.json()) as {
      temporaryPassword: string;
    };

    const secondaryMemberSession = await loginUserSession(
      app,
      "member@org.com",
      secondaryMemberProvisioned.temporaryPassword,
      orgId
    );

    const secondaryMemberListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions`, {
        headers: secondaryMemberSession.headers({}, orgId),
      })
    );

    expect(secondaryMemberListResp.status).toBe(200);
  });

  test("apply suggestion from wrong org returns 404", async () => {
    const { app, databaseAdapter, skillSuggestionService } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin3@org.com"
    );

    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId,
    });

    const otherOrgResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/org_other/skill-suggestions/${created.id}/apply`,
        {
          headers: adminSession.headers(
            { "X-CSRF-Token": adminSession.csrfToken },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(otherOrgResp.status).toBe(404);
  });

  test("gate flip on apply stages a proposal instead of writing", async () => {
    const {
      app,
      databaseAdapter,
      skillSuggestionService,
      skillProposalService,
    } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin4@org.com"
    );

    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId,
    });

    const org = await databaseAdapter.getOrganizationById(orgId);
    await databaseAdapter.upsertOrganization({
      ...org!,
      skillsWriteApproval: true,
    });

    const applyResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-suggestions/${created.id}/apply`,
        {
          headers: adminSession.headers(
            { "X-CSRF-Token": adminSession.csrfToken },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(applyResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const applyBody = (await applyResp.json()) as {
      outcome: string;
      proposalId?: string;
    };

    expect(applyBody.outcome).toBe("staged_as_proposal");
    expect(applyBody.proposalId).toBeTruthy();

    const { proposals } = await skillProposalService.listProposals(orgId, {
      profileId,
    });

    expect(
      proposals.some((proposal) => proposal.id === applyBody.proposalId)
    ).toBe(true);
  });

  test("a member cannot read or apply a private profile's suggestions", async () => {
    const { app, databaseAdapter, skillSuggestionService } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin5@org.com"
    );

    const orgId = adminSession.orgId!;
    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: "private_profile",
      isSuper: false,
      model: "openrouter/auto",
      name: "Private",
      orgId,
      ownerUserId: "user_other",
      sharedWithTeam: false,
      systemPrompt: "You are helpful.",
      updatedAt: now,
    });

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: "private_profile",
    });

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member5@org.com",
          name: "Member",
          role: "member",
        }),
        headers: adminSession.headers(
          { "X-CSRF-Token": adminSession.csrfToken },
          orgId
        ),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const provisioned = (await memberResp.json()) as {
      temporaryPassword: string;
    };

    const memberSession = await loginUserSession(
      app,
      "member5@org.com",
      provisioned.temporaryPassword,
      orgId
    );

    const listResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-suggestions?profileId=private_profile`,
        { headers: memberSession.headers({}, orgId) }
      )
    );

    expect(listResp.status).toBe(403);

    const memberListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions`, {
        headers: memberSession.headers({}, orgId),
      })
    );

    expect(memberListResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const memberList = (await memberListResp.json()) as {
      suggestions: unknown[];
    };

    expect(memberList.suggestions).toHaveLength(0);

    const applyResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-suggestions/${created.id}/apply`,
        {
          headers: memberSession.headers(
            { "X-CSRF-Token": memberSession.csrfToken },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(applyResp.status).toBe(403);

    const adminListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions`, {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(adminListResp.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const adminList = (await adminListResp.json()) as {
      suggestions: unknown[];
    };

    expect(adminList.suggestions).toHaveLength(1);
  });
});
