import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { OrgMemoryService } from "../../services/org-memory-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession, loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-org-memory-routes-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgMemoryService = new OrgMemoryService(databaseAdapter);
  return {
    databaseAdapter,
    authService,
    orgMemoryService,
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
      orgMemoryService,
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

const BASE = "http://localhost:4310";

describe("org memory routes (v1)", () => {
  test("admin can add a fact, get memory, search, pin, unpin, archive", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin@org.com");
    const orgId = adminSession.orgId!;

    const addResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/facts`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ bullet: "deploys ship on Tuesdays", pin: true }),
      }),
    );
    expect(addResp.status).toBe(200);
    const afterAdd = (await addResp.json()) as { content: string };
    expect(afterAdd.content).toContain("- deploys ship on Tuesdays");
    expect(afterAdd.content).toContain("## Pinned");

    const getResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory`, { headers: adminSession.headers({}, orgId) }),
    );
    expect(getResp.status).toBe(200);
    expect(((await getResp.json()) as { content: string }).content).toContain("deploys ship on Tuesdays");

    const searchResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/search`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ query: "Tuesdays" }),
      }),
    );
    expect(searchResp.status).toBe(200);
    const searchBody = (await searchResp.json()) as { matches: { bullet: string }[] };
    expect(searchBody.matches.some((m) => m.bullet.includes("Tuesdays"))).toBe(true);

    const unpinResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/unpin`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ bullet: "deploys ship on Tuesdays" }),
      }),
    );
    expect(unpinResp.status).toBe(200);
    expect(((await unpinResp.json()) as { content: string }).content).not.toContain("deploys ship on Tuesdays");

    // re-add then archive
    await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/facts`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ bullet: "stale fact", pin: true }),
      }),
    );
    const archiveResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/archive`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ entries: ["stale fact"] }),
      }),
    );
    expect(archiveResp.status).toBe(200);
    expect(((await archiveResp.json()) as { archived: number }).archived).toBe(1);
  });

  test("member can read and search but not mutate", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin2@org.com");
    const orgId = adminSession.orgId!;

    // add a fact as admin
    await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/facts`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ bullet: "shared fact", pin: true }),
      }),
    );

    // create a member
    const addMemberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({
          name: "Member",
          email: "member2@org.com",
          phone: "+628123456789",
          role: "member",
        }),
      }),
    );
    expect(addMemberResp.status).toBe(201);
    const memberProvisioned = (await addMemberResp.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(app, "member2@org.com", memberProvisioned.temporaryPassword, orgId);

    const getResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory`, { headers: memberSession.headers({}, orgId) }),
    );
    expect(getResp.status).toBe(200);

    const searchResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/search`, {
        method: "POST",
        headers: memberSession.headers({ "X-CSRF-Token": memberSession.csrfToken }, orgId),
        body: JSON.stringify({ query: "shared" }),
      }),
    );
    expect(searchResp.status).toBe(200);

    const putResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory`, {
        method: "PUT",
        headers: memberSession.headers({ "X-CSRF-Token": memberSession.csrfToken }, orgId),
        body: JSON.stringify({ content: "## Org Memory\n\n## Pinned\n\n- x\n" }),
      }),
    );
    expect(putResp.status).toBe(403);
  });

  test("viewer is blocked from read and search", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin3@org.com");
    const orgId = adminSession.orgId!;

    const addViewerResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({
          name: "Viewer",
          email: "viewer3@org.com",
          phone: "+628123456789",
          role: "viewer",
        }),
      }),
    );
    const viewerProvisioned = (await addViewerResp.json()) as { temporaryPassword: string };
    const viewerSession = await loginUserSession(app, "viewer3@org.com", viewerProvisioned.temporaryPassword, orgId);

    const getResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory`, { headers: viewerSession.headers({}, orgId) }),
    );
    expect(getResp.status).toBe(403);

    const searchResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/search`, {
        method: "POST",
        headers: viewerSession.headers({ "X-CSRF-Token": viewerSession.csrfToken }, orgId),
        body: JSON.stringify({ query: "x" }),
      }),
    );
    expect(searchResp.status).toBe(403);
  });

  test("PUT oversized body is rejected; cross-org is 404", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin4@org.com");
    const orgId = adminSession.orgId!;

    const huge = "x".repeat(10_000);
    const oversized = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory`, {
        method: "PUT",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ content: huge }),
      }),
    );
    expect(oversized.status).toBe(400);

    // cross-org: target a different orgId than the session's active org
    const crossResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/org_other/memory`, {
        headers: adminSession.headers({}, orgId),
      }),
    );
    expect(crossResp.status).toBe(404);
  });

  test("unpin/archive missing bullet returns 404", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin5@org.com");
    const orgId = adminSession.orgId!;

    const unpinResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/unpin`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ bullet: "no such fact" }),
      }),
    );
    expect(unpinResp.status).toBe(404);

    const archiveResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/archive`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ entries: ["no such fact"] }),
      }),
    );
    expect(archiveResp.status).toBe(404);
  });

  test("admin can list, approve, and reject proposals; member cannot list", async () => {
    const { app, authService, databaseAdapter, orgMemoryService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin6@org.com");
    const orgId = adminSession.orgId!;

    const proposed = await orgMemoryService.propose(orgId, {
      bullet: "deploy freeze on Fridays",
      profileId: "profile_a",
    });
    expect(proposed.outcome).toBe("created");

    const listResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/proposals?status=pending`, {
        headers: adminSession.headers({}, orgId),
      }),
    );
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as {
      proposals: { id: string; bullet: string }[];
      pendingCount: number;
    };
    expect(listBody.pendingCount).toBe(1);
    expect(listBody.proposals[0]?.bullet).toBe("deploy freeze on Fridays");

    const approveResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/proposals/${proposed.proposalId}/approve`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({ pin: false }),
      }),
    );
    expect(approveResp.status).toBe(200);
    const approveBody = (await approveResp.json()) as { content: string };
    expect(approveBody.content).toContain("deploy freeze on Fridays");

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({
          email: "member6@org.com",
          name: "Member Six",
          role: "member",
        }),
      }),
    );
    const memberProvisioned = (await memberResp.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(
      app,
      "member6@org.com",
      memberProvisioned.temporaryPassword,
      orgId,
    );
    const memberListResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/memory/proposals`, {
        headers: memberSession.headers({}, orgId),
      }),
    );
    expect(memberListResp.status).toBe(403);
  });

  test("approve proposal from wrong org returns 404", async () => {
    const { app, databaseAdapter, orgMemoryService } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter, "admin7@org.com");
    const orgId = adminSession.orgId!;
    const proposed = await orgMemoryService.propose(orgId, { bullet: "org scoped fact" });

    const otherOrgResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/org_other/memory/proposals/${proposed.proposalId}/approve`, {
        method: "POST",
        headers: adminSession.headers({ "X-CSRF-Token": adminSession.csrfToken }, orgId),
        body: JSON.stringify({}),
      }),
    );
    expect(otherOrgResp.status).toBe(404);
  });
});
