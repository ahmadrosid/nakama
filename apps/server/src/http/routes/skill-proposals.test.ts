import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { SkillProposalService } from "../../services/skill-proposal-service";
import { SkillsService } from "../../services/skills-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession, loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-skill-proposals-routes-test-");

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
  return {
    databaseAdapter,
    authService,
    skillsService,
    skillProposalService,
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
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

const BASE = "http://localhost:4310";

describe("skill proposal routes (v1)", () => {
  test("admin can list, approve, and reject proposals; member needs sessionId to list", async () => {
    const { app, authService, databaseAdapter, skillProposalService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin@org.com");
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;
    const sessionId = "sess_post_turn_notice";

    const staged = await skillProposalService.stageProposal({
      orgId,
      profileId,
      action: "create",
      content: sampleSkillMarkdown,
      sessionId,
    });
    expect(staged.outcome).toBe("created");

    const listResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-proposals?status=pending&profileId=${profileId}`, {
        headers: adminSession.headers({}, orgId),
      }),
    );
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as {
      proposals: { id: string; skillName: string }[];
      pendingCount: number;
    };
    expect(listBody.pendingCount).toBe(1);
    expect(listBody.proposals[0]?.skillName).toBe("deploy-notes");

    const approveResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-proposals/${staged.proposalId}/approve`,
        {
          method: "POST",
          headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        },
      ),
    );
    expect(approveResp.status).toBe(200);
    const approveBody = (await approveResp.json()) as { proposal: { status: string } };
    expect(approveBody.proposal.status).toBe("approved");

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({
          email: "member@org.com",
          name: "Member",
          role: "member",
        }),
      }),
    );
    const memberProvisioned = (await memberResp.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(
      app,
      "member@org.com",
      memberProvisioned.temporaryPassword,
      orgId,
    );
    const memberListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/skill-proposals`, {
        headers: memberSession.headers({}, orgId),
      }),
    );
    expect(memberListResp.status).toBe(403);

    const otherStaged = await skillProposalService.stageProposal({
      orgId,
      profileId,
      action: "create",
      content: sampleSkillMarkdown.replace("deploy-notes", "rollback-notes").replace(
        "Notes about deploy process.",
        "Notes about rollback.",
      ),
      sessionId,
    });
    expect(otherStaged.outcome).toBe("created");

    const memberSessionListResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-proposals?status=pending&sessionId=${encodeURIComponent(sessionId)}`,
        {
          headers: memberSession.headers({}, orgId),
        },
      ),
    );
    expect(memberSessionListResp.status).toBe(200);
    const memberSessionBody = (await memberSessionListResp.json()) as {
      proposals: { skillName: string; sessionId: string | null }[];
      pendingCount: number;
    };
    expect(memberSessionBody.pendingCount).toBe(1);
    expect(memberSessionBody.proposals).toHaveLength(1);
    expect(memberSessionBody.proposals[0]?.skillName).toBe("rollback-notes");
    expect(memberSessionBody.proposals[0]?.sessionId).toBe(sessionId);
  });

  test("admin can reject a pending proposal", async () => {
    const { app, databaseAdapter, skillProposalService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin2@org.com");
    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const staged = await skillProposalService.stageProposal({
      orgId,
      profileId,
      action: "create",
      content: sampleSkillMarkdown,
    });

    const rejectResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/skill-proposals/${staged.proposalId}/reject`,
        {
          method: "POST",
          headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        },
      ),
    );
    expect(rejectResp.status).toBe(200);
    const rejectBody = (await rejectResp.json()) as { proposal: { status: string } };
    expect(rejectBody.proposal.status).toBe("rejected");
  });

  test("approve proposal from wrong org returns 404 (AE6)", async () => {
    const { app, databaseAdapter, skillProposalService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin3@org.com");
    const orgId = adminSession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const staged = await skillProposalService.stageProposal({
      orgId,
      profileId,
      action: "create",
      content: sampleSkillMarkdown,
    });

    const otherOrgResp = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/org_other/skill-proposals/${staged.proposalId}/approve`,
        {
          method: "POST",
          headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        },
      ),
    );
    expect(otherOrgResp.status).toBe(404);
  });
});
