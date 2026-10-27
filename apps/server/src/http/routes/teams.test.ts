import { afterEach, describe, expect, test } from "bun:test";
import {
  createTeamsWorkerHeartbeat,
  saveTeamsConfig,
  saveTeamsInboundPort,
} from "@nakama/core";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  type AppFetch,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";

setupTestConfigDir("nakama-teams-routes-test-");

const PROFILE_ID = "agent_teams";

const CREDENTIALS = {
  allowedUserIds: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "teams-secret",
  tenantId: "33333333-3333-4333-8333-333333333333",
};

/** The save path asks Microsoft for a token; only that call is stubbed. */
async function withTokenEndpointStubbed<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;

  // SAFETY: The stub takes the same inputs as fetch and delegates everything
  // that is not the Microsoft token endpoint to the real one.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).startsWith(
      "https://login.microsoftonline.com/"
    )
      ? Response.json({ access_token: "token", token_type: "Bearer" })
      : // SAFETY: Narrowed from the fetch input union the caller passed in.
        original(input as RequestInfo, init)) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const servers: { stop: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

/** A stand-in for the worker's SDK listener, bound to loopback like the real one. */
function startFakeWorker(
  handler: (request: Request) => Response | Promise<Response>
) {
  const server = Bun.serve({ fetch: handler, hostname: "127.0.0.1", port: 0 });

  servers.push(server);

  return server;
}

async function setupOwnedProfile() {
  // The owner check reads the agent, so the harness needs one that answers.
  const { app, authService, databaseAdapter } = createMinimalHonoApp({
    agent: {
      getProfile: async (_orgId: string, id: string) => ({
        profile: { id, isSuper: false, ownerUserId: "user_admin" },
      }),
      listProfiles: async () => ({ profiles: [{ id: PROFILE_ID }] }),
    },
  });

  const fetchApp: AppFetch = app;

  await seedOrgAdmin(databaseAdapter, { authService, profileId: PROFILE_ID });

  const admin = await loginUserSession(
    fetchApp,
    "admin@example.com",
    "password123"
  );

  return { admin, app, databaseAdapter, fetchApp, profileId: PROFILE_ID };
}

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
});

describe("teams webhook proxy", () => {
  async function configureLiveWorker(
    profileId: string,
    handler: (request: Request) => Response | Promise<Response>
  ) {
    const owner = { orgId: "org_test", profileId };

    await withTokenEndpointStubbed(() => saveTeamsConfig(CREDENTIALS, owner));

    const server = startFakeWorker(handler);

    await saveTeamsInboundPort(server.port, owner);
    await createTeamsWorkerHeartbeat(owner).write(true);

    return server;
  }

  test("forwards the body and the Authorization header to the owner's worker", async () => {
    const { app, profileId } = await setupOwnedProfile();

    const seen: { auth: string | null; body: string; cookie: string | null }[] =
      [];

    await configureLiveWorker(profileId, async (request) => {
      seen.push({
        auth: request.headers.get("authorization"),
        body: await request.text(),
        cookie: request.headers.get("cookie"),
      });

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ text: "hello", type: "message" }),
          headers: {
            Authorization: "Bearer teams-service-token",
            "Content-Type": "application/json",
            Cookie: "nakama_session=should-not-be-forwarded",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.auth).toBe("Bearer teams-service-token");
    expect(JSON.parse(String(seen[0]?.body))).toEqual({
      text: "hello",
      type: "message",
    });
    expect(seen[0]?.cookie).toBeNull();
  });

  test("refuses when the worker is not running, even with a saved port", async () => {
    const { app, profileId } = await setupOwnedProfile();
    const owner = { orgId: "org_test", profileId };
    let reached = false;

    await withTokenEndpointStubbed(() => saveTeamsConfig(CREDENTIALS, owner));

    const server = startFakeWorker(() => {
      reached = true;

      return Response.json({ ok: true });
    });

    await saveTeamsInboundPort(server.port, owner);
    await createTeamsWorkerHeartbeat(owner).clear();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
    expect(reached).toBe(false);
  });

  test("ignores an organization chosen by the caller", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = 0;

    await configureLiveWorker(profileId, () => {
      reached += 1;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages?orgId=org_attacker`,
        {
          body: JSON.stringify({ orgId: "org_attacker", type: "message" }),
          headers: {
            "Content-Type": "application/json",
            "X-Org-Id": "org_attacker",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(reached).toBe(1);
  });

  test("refuses an unknown agent without reaching any worker", async () => {
    const { app } = await setupOwnedProfile();

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/channels/teams/profile_missing/messages",
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(404);
  });

  test("refuses a body larger than the forwarding limit", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = false;

    await configureLiveWorker(profileId, () => {
      reached = true;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: "x".repeat(1_100_000),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(reached).toBe(false);
  });

  test("does not follow a redirect the worker returns", async () => {
    const { app, profileId } = await setupOwnedProfile();

    await configureLiveWorker(
      profileId,
      () =>
        new Response(null, {
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
          status: 302,
        })
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(502);
  });
});
