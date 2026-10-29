import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  type AppFetch,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";
import {
  CREDENTIALS,
  MEMBER_PROFILE_ID,
  PROFILE_ID,
  putSettings,
  setupOwnedProfile,
  withTokenEndpointStubbed,
} from "../test-teams-helpers";

setupTestConfigDir("nakama-teams-routes-test-");

describe("teams settings", () => {
  test("an org admin saves credentials and reads them back without the secret", async () => {
    const { admin, app, profileId } = await setupOwnedProfile();

    const saved = await withTokenEndpointStubbed(async () =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/settings/teams?profileId=${profileId}`,
          {
            body: JSON.stringify(CREDENTIALS),
            headers: admin.headers({
              "Content-Type": "application/json",
              "X-CSRF-Token": admin.csrfToken,
            }),
            method: "PUT",
          }
        )
      )
    );

    expect(saved.status).toBe(200);

    const body = await saved.json();

    expect(body).toMatchObject({
      clientId: CREDENTIALS.clientId,
      clientSecretConfigured: true,
      configured: true,
      tenantId: CREDENTIALS.tenantId,
    });
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.clientSecret);
  });

  test("a member cannot configure another agent's connection", async () => {
    const { app, databaseAdapter, fetchApp, profileId } =
      await setupOwnedProfile();

    await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: "org_test",
      role: "member",
      userId: "user_member",
    });

    const member = await loginUserSession(
      fetchApp,
      "member@example.com",
      "password123"
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/settings/teams?profileId=${profileId}`,
        {
          body: JSON.stringify(CREDENTIALS),
          headers: member.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": member.csrfToken,
          }),
          method: "PUT",
        }
      )
    );

    expect(response.status).toBe(403);
  });

  test("a member cannot connect even an agent they own", async () => {
    const { admin, app, databaseAdapter, fetchApp, workerCalls } =
      await setupOwnedProfile();

    await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: "org_test",
      role: "member",
      userId: "user_member",
    });

    const member = await loginUserSession(
      fetchApp,
      "member@example.com",
      "password123"
    );

    const denied = await withTokenEndpointStubbed(() =>
      putSettings(app, member, MEMBER_PROFILE_ID)
    );

    expect(denied.status).toBe(403);
    expect(workerCalls).toEqual([]);

    // The positive control: an admin may connect the member's agent.
    const allowed = await withTokenEndpointStubbed(() =>
      putSettings(app, admin, MEMBER_PROFILE_ID)
    );

    expect(allowed.status).toBe(200);
  });

  test("a save runs through the worker manager, so a running worker restarts on the new credentials", async () => {
    const { admin, app, profileId, workerCalls } = await setupOwnedProfile();

    const saved = await withTokenEndpointStubbed(() =>
      putSettings(app, admin, profileId)
    );

    expect(saved.status).toBe(200);
    expect(workerCalls).toEqual([`save:teams:org_test:${profileId}`]);
  });

  test("an admin of another organization cannot reach this agent's connection", async () => {
    // The real agent service, which knows which organization owns an agent.
    const databaseAdapter = createInMemoryDatabaseAdapter();

    const { app, authService } = createMinimalHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      databaseAdapter,
    });

    const fetchApp: AppFetch = app;

    await seedOrgAdmin(databaseAdapter, { authService, profileId: PROFILE_ID });
    await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "other@example.com",
      orgId: "org_other",
      userId: "user_other",
    });

    const admin = await loginUserSession(
      fetchApp,
      "admin@example.com",
      "password123"
    );

    const other = await loginUserSession(
      fetchApp,
      "other@example.com",
      "password123",
      "org_other"
    );

    const read = (session: typeof admin) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/settings/teams?profileId=${PROFILE_ID}`,
          { headers: session.headers() }
        )
      );

    // The positive control: the owning admin reaches the same agent.
    expect((await read(admin)).status).toBe(200);
    expect((await read(other)).status).toBe(404);
    expect(
      (
        await withTokenEndpointStubbed(() =>
          putSettings(app, other, PROFILE_ID)
        )
      ).status
    ).toBe(404);
  });
});

describe("teams worker controls", () => {
  test("only an org admin starts the agent's Teams worker", async () => {
    const { admin, app, databaseAdapter, fetchApp, profileId, workerCalls } =
      await setupOwnedProfile();

    await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: "org_test",
      role: "member",
      userId: "user_member",
    });

    const member = await loginUserSession(
      fetchApp,
      "member@example.com",
      "password123"
    );

    const start = (session: typeof admin) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/workers/teams/start?profileId=${profileId}`,
          {
            headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
            method: "POST",
          }
        )
      );

    expect((await start(member)).status).toBe(403);
    expect(workerCalls).toEqual([]);

    // The positive control: the same request from the admin goes through.
    expect((await start(admin)).status).toBe(200);
    expect(workerCalls).toEqual([`start:teams:org_test:${profileId}`]);
  });
});
