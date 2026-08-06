import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { ProfileService } from "../../services/profile-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession, loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-profiles-skills-write-approval-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const profileService = new ProfileService(databaseAdapter);
  return {
    databaseAdapter,
    authService,
    profileService,
    app: createHonoApp({
      agent: {
        updateProfile: (orgId: string, profileId: string, body: unknown) =>
          profileService.updateProfile(orgId, profileId, body as Parameters<ProfileService["updateProfile"]>[2]),
      } as never,
      automationService: {} as never,
      taskService: {} as never,
      systemStatus: { getStatus: async () => ({ ok: true }) } as never,
      workerManager: {} as never,
      mcpService: {} as never,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

const BASE = "http://localhost:4310";

describe("profile skillsWriteApproval auth", () => {
  test("org admin can patch skillsWriteApproval only; other fields forbidden", async () => {
    const { app, databaseAdapter } = createApp();
    const platformSession = await setupFreshInstallSession(app, databaseAdapter, "platform@org.com");
    const orgId = platformSession.orgId!;

    const inviteResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: platformSession.headers({ "X-CSRF-Token": platformSession.csrfToken }, orgId),
        body: JSON.stringify({
          email: "orgadmin@org.com",
          name: "Org Admin",
          role: "admin",
        }),
      }),
    );
    const invited = (await inviteResp.json()) as { temporaryPassword: string };
    const orgAdminSession = await loginUserSession(
      app,
      "orgadmin@org.com",
      invited.temporaryPassword,
      orgId,
    );

    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;

    const okResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        method: "PUT",
        headers: orgAdminSession.headers({ "X-CSRF-Token": orgAdminSession.csrfToken }, orgId),
        body: JSON.stringify({ skillsWriteApproval: true }),
      }),
    );
    expect(okResp.status).toBe(200);
    const okBody = (await okResp.json()) as { profile: { skillsWriteApproval: boolean | null } };
    expect(okBody.profile.skillsWriteApproval).toBe(true);

    const reviewResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        method: "PUT",
        headers: orgAdminSession.headers({ "X-CSRF-Token": orgAdminSession.csrfToken }, orgId),
        body: JSON.stringify({ skillsPostTurnReview: true }),
      }),
    );
    expect(reviewResp.status).toBe(200);
    const reviewBody = (await reviewResp.json()) as {
      profile: { skillsPostTurnReview: boolean | null };
    };
    expect(reviewBody.profile.skillsPostTurnReview).toBe(true);

    const forbiddenResp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        method: "PUT",
        headers: orgAdminSession.headers({ "X-CSRF-Token": orgAdminSession.csrfToken }, orgId),
        body: JSON.stringify({ name: "Renamed", skillsWriteApproval: false }),
      }),
    );
    expect(forbiddenResp.status).toBe(403);
  });
});
