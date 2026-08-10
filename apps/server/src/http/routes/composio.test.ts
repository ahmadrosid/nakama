import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveComposioConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import type { ComposioApiClient } from "../../services/composio-api-client";
import { ComposioService } from "../../services/composio-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { loginUserSession } from "../test-session-helpers";

const TEST_API_KEY = "ck_test";

function createMockClient(): ComposioApiClient {
  return {
    async createProfileSession() {
      return {
        headers: { Authorization: "Bearer test" },
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
      };
    },
    async deleteConnectedAccount() {},
    async linkToolkitAccount() {
      return { redirectUrl: "https://example.com/oauth" };
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

async function seedOrgAdmin(
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>
) {
  const email = "admin@example.com";
  const password = "password123";
  const orgId = "org_test";
  const now = new Date().toISOString();
  const authService = new AuthService();

  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: "user_admin",
    passwordHash: await authService.hashPassword(password),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: "Test Org",
    slug: "test-org",
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId,
    role: "admin",
    userId: "user_admin",
  });

  const profileId = "profile_test";
  await databaseAdapter.upsertProfile({
    createdAt: now,
    id: profileId,
    isSuper: false,
    model: "openrouter/auto",
    name: "Default",
    orgId,
    systemPrompt: "You are helpful.",
    updatedAt: now,
  });

  return { email, orgId, password, profileId };
}

async function createApp() {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-route-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await saveComposioConfig({ apiKey: TEST_API_KEY });

  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const composioService = new ComposioService(databaseAdapter, authService);
  composioService.reloadConfiguration();
  (
    composioService as unknown as {
      apiClientCache: { key: string; client: ComposioApiClient } | null;
    }
  ).apiClientCache = {
    client: createMockClient(),
    key: TEST_API_KEY,
  };

  return {
    app: createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      automationService: {} as any,
      composioService,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      taskService: {} as any,
      webDistDir: null,
      workerManager: {} as any,
    }),
    composioService,
    databaseAdapter,
  };
}

describe("composio routes", () => {
  test("org admin can enable toolkit and assign it to a profile", async () => {
    const { app, databaseAdapter } = await createApp();
    const { email, password, orgId, profileId } =
      await seedOrgAdmin(databaseAdapter);
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
    const enabled = (await enableResponse.json()) as {
      toolkitSlug: string;
      id: string;
    };
    expect(enabled.toolkitSlug).toBe("gmail");

    const assignResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${encodeURIComponent(profileId)}/composio-toolkits`,
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
    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter);
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
    await expect(connectResponse.json()).resolves.toMatchObject({
      redirectUrl: "https://example.com/oauth",
    });

    const connections =
      await databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        "user_admin"
      );
    expect(connections).toHaveLength(1);
    expect(connections[0]?.userId).toBe("user_admin");
    expect(connections[0]?.status).toBe("oauth_in_progress");
  });

  test("org member can list toolkits but cannot enable them", async () => {
    const { app, databaseAdapter } = await createApp();
    const { orgId } = await seedOrgAdmin(databaseAdapter);
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
