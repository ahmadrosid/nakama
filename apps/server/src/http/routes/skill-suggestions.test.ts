import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { SkillProposalService } from "../../services/skill-proposal-service";
import { SkillSuggestionService } from "../../services/skill-suggestion-service";
import { SkillsService } from "../../services/skills-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession, loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-skill-suggestions-routes-test-");

const sampleSkillMarkdown = `---
name: deploy-notes
description: Notes about deploy process.
---

Run the deploy checklist before shipping.
`;

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const skillsService = new SkillsService(databaseAdapter);
  const skillProposalService = new SkillProposalService(databaseAdapter, skillsService);
  const skillSuggestionService = new SkillSuggestionService(
    databaseAdapter,
    skillsService,
    skillProposalService,
  );
  return {
    databaseAdapter,
    authService,
    skillsService,
    skillProposalService,
    skillSuggestionService,
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      } as any,
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      workerManager: {} as any,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      skillProposalService,
      skillSuggestionService,
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

const BASE = "http://localhost:4310";

describe("skill suggestion routes (v1)", () => {
  test("admin can list and apply suggestions; member can too; viewer is forbidden", async () => {
    const { app, databaseAdapter, skillSuggestionService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin@org.com");
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      profileId,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    const listResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions?status=pending`, {
        headers: adminSession.headers({}, orgId),
      }),
    );
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as {
      suggestions: { id: string; skillName: string }[];
    };
    expect(listBody.suggestions).toHaveLength(1);
    expect(listBody.suggestions[0]?.skillName).toBe("deploy-notes");

    const applyResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions/${created.id}/apply`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
      }),
    );
    expect(applyResp.status).toBe(200);
    const applyBody = (await applyResp.json()) as {
      outcome: string;
      suggestion: { status: string };
    };
    expect(applyBody.outcome).toBe("applied");
    expect(applyBody.suggestion.status).toBe("applied");

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({
          email: "viewer@org.com",
          name: "Viewer",
          role: "viewer",
        }),
      }),
    );
    const viewerProvisioned = (await memberResp.json()) as { temporaryPassword: string };
    const viewerSession = await loginUserSession(
      app,
      "viewer@org.com",
      viewerProvisioned.temporaryPassword,
      orgId,
    );
    const viewerListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions`, {
        headers: viewerSession.headers({}, orgId),
      }),
    );
    expect(viewerListResp.status).toBe(403);
  });

  test("apply suggestion from wrong org returns 404", async () => {
    const { app, databaseAdapter, skillSuggestionService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin3@org.com");
    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      profileId,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    const otherOrgResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/org_other/skill-suggestions/${created.id}/apply`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
      }),
    );
    expect(otherOrgResp.status).toBe(404);
  });

  test("gate flip on apply stages a proposal instead of writing", async () => {
    const { app, databaseAdapter, skillSuggestionService, skillProposalService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin4@org.com");
    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const created = await skillSuggestionService.createSuggestion({
      orgId,
      profileId,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    const org = await databaseAdapter.getOrganizationById(orgId);
    await databaseAdapter.upsertOrganization({ ...org!, skillsWriteApproval: true });

    const applyResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-suggestions/${created.id}/apply`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
      }),
    );
    expect(applyResp.status).toBe(200);
    const applyBody = (await applyResp.json()) as { outcome: string; proposalId?: string };
    expect(applyBody.outcome).toBe("staged_as_proposal");
    expect(applyBody.proposalId).toBeTruthy();

    const { proposals } = await skillProposalService.listProposals(orgId, { profileId });
    expect(proposals.some((proposal) => proposal.id === applyBody.proposalId)).toBe(true);
  });
});
