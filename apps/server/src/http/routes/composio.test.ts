import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveComposioConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { AgentService } from "../../services/agent-service";
import { OrgService } from "../../services/org-service";
import { ComposioService } from "../../services/composio-service";
import type { ComposioApiClient } from "../../services/composio-api-client";
import { loginUserSession } from "../test-session-helpers";

const TEST_API_KEY = "ck_test";

function createMockClient(): ComposioApiClient {
  return {
    async listCatalogToolkits() {
      return [{ slug: "gmail", name: "Gmail", description: "Google Mail", logoUrl: null }];
    },
    async linkToolkitAccount() {
      return { redirectUrl: "https://example.com/oauth" };
    },
    async deleteConnectedAccount() {},
    async createProfileSession() {
      return {
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
        headers: { Authorization: "Bearer test" },
      };
    },
    async listSessionTools() {
      return [];
    },
  };
}

async function seedOrgAdmin(databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>) {
  const email = "admin@example.com";
  const password = "password123";
  const orgId = "org_test";
  const now = new Date().toISOString();
  const authService = new AuthService();

  await databaseAdapter.createUser({
    id: "user_admin",
    email,
    passwordHash: await authService.hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrganization({
    id: orgId,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    orgId,
    userId: "user_admin",
    role: "admin",
    createdAt: now,
  });

  const profileId = "profile_test";
  await databaseAdapter.upsertProfile({
    id: profileId,
    orgId,
    name: "Default",
    systemPrompt: "You are helpful.",
    model: "openrouter/auto",
    isSuper: false,
    createdAt: now,
    updatedAt: now,
  });

  return { email, password, orgId, profileId };
}

async function createApp() {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-route-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await saveComposioConfig({ apiKey: TEST_API_KEY });

  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const composioService = new ComposioService(databaseAdapter, authService);
  composioService.reloadConfiguration();
  (composioService as unknown as { apiClientCache: { key: string; client: ComposioApiClient } | null }).apiClientCache =
    {
      key: TEST_API_KEY,
      client: createMockClient(),
    };

  return {
    databaseAdapter,
    composioService,
    app: createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      workerManager: {} as any,
      mcpService: {} as any,
      composioService,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

describe("composio routes", () => {
  test("org admin can enable toolkit and assign it to a profile", async () => {
    const { app, databaseAdapter } = await createApp();
    const { email, password, orgId, profileId } = await seedOrgAdmin(databaseAdapter);
    const session = await loginUserSession(app, email, password, orgId);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ toolkitSlug: "gmail" }),
      }),
    );

    expect(enableResponse.status).toBe(200);
    const enabled = (await enableResponse.json()) as { toolkitSlug: string; id: string };
    expect(enabled.toolkitSlug).toBe("gmail");

    const assignResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${encodeURIComponent(profileId)}/composio-toolkits`,
        {
          method: "PUT",
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            assignments: [{ toolkitId: enabled.id }],
          }),
        },
      ),
    );

    expect(assignResponse.status).toBe(200);
    await expect(assignResponse.json()).resolves.toMatchObject({
      assignments: [expect.objectContaining({ toolkitSlug: "gmail", toolkitId: enabled.id })],
    });
  });

  test("org admin can connect an enabled toolkit with their user id", async () => {
    const { app, databaseAdapter } = await createApp();
    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter);
    const session = await loginUserSession(app, email, password, orgId);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ toolkitSlug: "gmail" }),
      }),
    );

    expect(enableResponse.status).toBe(200);

    const connectResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/connect", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ callbackOrigin: "http://localhost:3003" }),
      }),
    );

    expect(connectResponse.status).toBe(200);
    await expect(connectResponse.json()).resolves.toMatchObject({
      redirectUrl: "https://example.com/oauth",
    });

    const connections = await databaseAdapter.listComposioUserConnectionsForUser(orgId, "user_admin");
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
      id: "user_member",
      email: "member@example.com",
      passwordHash: await authService.hashPassword("password123"),
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      orgId,
      userId: "user_member",
      role: "member",
      createdAt: now,
    });

    const session = await loginUserSession(app, "member@example.com", "password123", orgId);
    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits", {
        headers: session.headers(),
      }),
    );

    expect(listResponse.status).toBe(200);

    const enableResponse = await app.fetch(
      new Request("http://localhost:4310/v1/composio/toolkits/gmail/enable", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ toolkitSlug: "gmail" }),
      }),
    );

    expect(enableResponse.status).toBe(403);
  });
});
