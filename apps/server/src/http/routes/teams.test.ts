import { describe, expect, test } from "bun:test";
import { withPairingConfigLock } from "@nakama/core/channel-config-shared";
import {
  getTeamsConfigDir,
  loadTeamsConfigFile,
  regenerateTeamsHandshake,
  verifyAndPairTeamsUser,
} from "@nakama/core/teams-config";
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
  test("an admin generates and replaces a code without restarting the worker", async () => {
    const { admin, app, profileId, workerCalls } = await setupOwnedProfile();
    await withTokenEndpointStubbed(() => putSettings(app, admin, profileId));

    const generate = () =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/settings/teams/handshake?profileId=${profileId}`,
          {
            method: "POST",
            headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
          }
        )
      );

    const first = await generate();
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.handshakeCode).toMatch(/^[0-9A-F]{32}$/);
    expect(Date.parse(firstBody.handshakeExpiresAt)).toBeGreaterThan(
      Date.now()
    );
    expect(JSON.stringify(firstBody)).not.toContain(CREDENTIALS.clientSecret);
    const second = await generate();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.handshakeCode).not.toBe(firstBody.handshakeCode);
    const owner = { orgId: "org_test", profileId };
    expect((await loadTeamsConfigFile(owner))?.handshakeCode).toBe(
      secondBody.handshakeCode
    );
    expect(
      (
        await verifyAndPairTeamsUser(
          firstBody.handshakeCode,
          CREDENTIALS.clientId,
          CREDENTIALS.tenantId,
          owner
        )
      ).ok
    ).toBe(false);
    expect((await loadTeamsConfigFile(owner))?.handshakeCode).toBe(
      secondBody.handshakeCode
    );
    expect(
      (
        await verifyAndPairTeamsUser(
          secondBody.handshakeCode,
          CREDENTIALS.clientId,
          CREDENTIALS.tenantId,
          owner
        )
      ).ok
    ).toBe(true);

    const linked = await app.fetch(
      new Request(
        `http://localhost:4310/v1/settings/teams?profileId=${profileId}`,
        { headers: admin.headers() }
      )
    );

    expect(await linked.json()).toMatchObject({
      handshakeCode: null,
      handshakeExpiresAt: null,
      pairedUserIds: [CREDENTIALS.clientId],
    });
    expect(workerCalls).toEqual([`save:teams:org_test:${profileId}`]);
  });

  test("a member can read their connection but cannot read or generate its pairing code", async () => {
    const { admin, app, databaseAdapter, fetchApp } = await setupOwnedProfile();
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

    await withTokenEndpointStubbed(() =>
      putSettings(app, admin, MEMBER_PROFILE_ID)
    );

    const generated = await regenerateTeamsHandshake({
      orgId: "org_test",
      profileId: MEMBER_PROFILE_ID,
    });

    const path = `http://localhost:4310/v1/settings/teams?profileId=${MEMBER_PROFILE_ID}`;

    const adminRead = await app.fetch(
      new Request(path, { headers: admin.headers() })
    );

    expect((await adminRead.json()).handshakeCode).toBe(
      generated.handshakeCode
    );

    const memberRead = await app.fetch(
      new Request(path, { headers: member.headers() })
    );

    expect(memberRead.status).toBe(200);
    const body = await memberRead.json();
    expect(body).toMatchObject({
      configured: true,
      handshakeCode: null,
      handshakeExpiresAt: null,
    });
    expect(JSON.stringify(body)).not.toContain(generated.handshakeCode!);

    const denied = await app.fetch(
      new Request(
        `http://localhost:4310/v1/settings/teams/handshake?profileId=${MEMBER_PROFILE_ID}`,
        {
          method: "POST",
          headers: member.headers({ "X-CSRF-Token": member.csrfToken }),
        }
      )
    );

    expect(denied.status).toBe(403);
    expect(
      (
        await loadTeamsConfigFile({
          orgId: "org_test",
          profileId: MEMBER_PROFILE_ID,
        })
      )?.handshakeCode
    ).toBe(generated.handshakeCode);
  });

  test("code generation requires login, CSRF, an agent, and a configured connection", async () => {
    const { admin, app, profileId } = await setupOwnedProfile();
    const endpoint = `http://localhost:4310/v1/settings/teams/handshake?profileId=${profileId}`;
    expect(
      (await app.fetch(new Request(endpoint, { method: "POST" }))).status
    ).toBe(401);
    expect(
      (
        await app.fetch(
          new Request(endpoint, { method: "POST", headers: admin.headers() })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request(endpoint, {
            method: "POST",
            headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await app.fetch(
          new Request("http://localhost:4310/v1/settings/teams/handshake", {
            method: "POST",
            headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
          })
        )
      ).status
    ).toBe(400);
  });
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
        await app.fetch(
          new Request(
            `http://localhost:4310/v1/settings/teams/handshake?profileId=${PROFILE_ID}`,
            {
              method: "POST",
              headers: other.headers({ "X-CSRF-Token": other.csrfToken }),
            }
          )
        )
      ).status
    ).toBe(404);
    expect(
      (
        await withTokenEndpointStubbed(() =>
          putSettings(app, other, PROFILE_ID)
        )
      ).status
    ).toBe(404);
  });

  test("a save while the config is locked returns 503", async () => {
    const { admin, app, profileId } = await setupOwnedProfile();

    const response = await withPairingConfigLock(
      getTeamsConfigDir({ orgId: "org_test", profileId }),
      () => withTokenEndpointStubbed(() => putSettings(app, admin, profileId))
    );

    expect(response.status).toBe(503);
  }, 15_000);
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
