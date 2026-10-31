import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import type { ComposioApiClient } from "../../services/composio-api-client";
import { ComposioService } from "../../services/composio-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

const TEST_API_KEY = "ck_test";

function createMockClient(): Pick<
  ComposioApiClient,
  | "createProfileSession"
  | "deleteConnectedAccount"
  | "linkToolkitAccount"
  | "listCatalogToolkits"
  | "listSessionTools"
> {
  return {
    async createProfileSession() {
      return {
        headers: { Authorization: "Bearer test" },
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
      };
    },
    async deleteConnectedAccount() {},
    async linkToolkitAccount(_userId, _toolkitSlug, callbackUrl) {
      return { redirectUrl: callbackUrl };
    },
    async listCatalogToolkits() {
      return [
        {
          description: "Google Mail",
          logoUrl: null,
          name: "Gmail",
          slug: "gmail",
        },
      ];
    },
    async listSessionTools() {
      return [];
    },
  };
}

async function createApp() {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-route-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  process.env.COMPOSIO_API_KEY = TEST_API_KEY;

  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const composioService = new ComposioService(databaseAdapter, authService);
  composioService.reloadConfiguration();

  Object.assign(composioService, {
    apiClientCache: {
      client: createMockClient(),
      key: TEST_API_KEY,
    },
  });

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    authService,
    composioService,
    databaseAdapter,
  });
}

describe("composio routes", () => {
  test("org admin can enable toolkit and assign it to a profile", async () => {
    const { app, databaseAdapter } = await createApp();

    const { email, password, orgId, profileId } = await seedOrgAdmin(
      databaseAdapter,
      { profileId: "profile_test" }
    );

    const session = await loginUserSession(app, email, password, orgId);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        body: JSON.stringify({ toolkitSlug: "gmail" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(enableResponse.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const enabled = (await enableResponse.json()) as {
      toolkitSlug: string;
      id: string;
    };

    expect(enabled.toolkitSlug).toBe("gmail");

    const assignResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${encodeURIComponent(profileId!)}/composio-toolkits`,
        {
          body: JSON.stringify({
            assignments: [{ toolkitId: enabled.id }],
          }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "PUT",
        }
      )
    );

    expect(assignResponse.status).toBe(200);
    await expect(assignResponse.json()).resolves.toMatchObject({
      assignments: [
        expect.objectContaining({
          toolkitId: enabled.id,
          toolkitSlug: "gmail",
        }),
      ],
    });
  });

  test("org admin can connect an enabled toolkit with their user id", async () => {
    const { app, databaseAdapter } = await createApp();

    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "profile_test",
    });

    const session = await loginUserSession(app, email, password, orgId);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        body: JSON.stringify({ toolkitSlug: "gmail" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(enableResponse.status).toBe(200);

    const connectResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/connect", {
        body: JSON.stringify({ callbackOrigin: "http://localhost:3003" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(connectResponse.status).toBe(200);

    // SAFETY: The test client returns the callback URL as its redirect URL.
    const { redirectUrl } = (await connectResponse.json()) as {
      redirectUrl: string;
    };

    const callbackResponse = await app.fetch(new Request(redirectUrl));

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(
      "/integrations?section=composio"
    );

    const connections =
      await databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        "user_admin"
      );

    expect(connections).toHaveLength(1);
    expect(connections[0]?.userId).toBe("user_admin");
    expect(connections[0]?.status).toBe("connected");
  });

  test("org member can list toolkits but cannot enable them", async () => {
    const { app, databaseAdapter } = await createApp();

    const { orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "profile_test",
    });

    const now = new Date().toISOString();
    const authService = new AuthService();

    await databaseAdapter.createUser({
      createdAt: now,
      email: "member@example.com",
      id: "user_member",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_member",
    });

    const session = await loginUserSession(
      app,
      "member@example.com",
      "password123",
      orgId
    );

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits", {
        headers: session.headers(),
      })
    );

    expect(listResponse.status).toBe(200);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        body: JSON.stringify({ toolkitSlug: "gmail" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(enableResponse.status).toBe(403);
  });

  test("org member adds a toolkit only to an agent they created", async () => {
    const { app, databaseAdapter } = await createApp();

    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "profile_admin",
    });

    const admin = await loginUserSession(app, email, password, orgId);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        body: JSON.stringify({ toolkitSlug: "gmail" }),
        headers: admin.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": admin.csrfToken,
        }),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const enabled = (await enableResponse.json()) as { id: string };

    const now = new Date().toISOString();
    const authService = new AuthService();

    await databaseAdapter.createUser({
      createdAt: now,
      email: "member@example.com",
      id: "user_member",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_member",
    });
    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: "profile_member",
      isSuper: false,
      model: "openrouter/auto",
      name: "Mine",
      orgId,
      ownerUserId: "user_member",
      systemPrompt: "You are helpful.",
      updatedAt: now,
    });

    const member = await loginUserSession(
      app,
      "member@example.com",
      "password123",
      orgId
    );

    const assign = (profileId: string) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/profiles/${profileId}/composio-toolkits`,
          {
            body: JSON.stringify({ assignments: [{ toolkitId: enabled.id }] }),
            headers: member.headers({
              "Content-Type": "application/json",
              "X-CSRF-Token": member.csrfToken,
            }),
            method: "PUT",
          }
        )
      );

    const own = await assign("profile_member");

    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({
      assignments: [expect.objectContaining({ toolkitId: enabled.id })],
    });

    expect((await assign("profile_admin")).status).toBe(403);
  });

  test("oauth callback does not require a browser session", async () => {
    const { app } = await createApp();

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/composio/oauth/callback?state=not-valid",
        {
          headers: { Accept: "application/json" },
        }
      )
    );

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid OAuth state.",
    });
  });
});
