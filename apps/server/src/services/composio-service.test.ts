import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveComposioConfig } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import { ComposioService } from "./composio-service";
import type { ComposioApiClient } from "./composio-api-client";

const TEST_API_KEY = "ck_test";
const USER_ID = "user_admin";
const ORG_ID = "org_1";

function createMockClient(): ComposioApiClient {
  return {
    async listCatalogToolkits() {
      return [{ slug: "gmail", name: "Gmail", description: "Google Mail", logoUrl: null }];
    },
    async linkToolkitAccount(_userId, _toolkitSlug) {
      return { redirectUrl: "https://example.com/oauth", connectedAccountId: "ca_1" };
    },
    async deleteConnectedAccount() {},
    async createProfileSession(userId, _toolkitSlugs, _allowedTools, connectedAccounts = {}) {
      expect(userId).toBe("nakama:user:user_admin");
      expect(connectedAccounts).toEqual({});
      return {
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
        headers: { Authorization: "Bearer test" },
      };
    },
    async listSessionTools() {
      return [
        {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send Email",
          description: "Send an email",
          inputSchema: { type: "object", properties: {} },
        },
      ];
    },
  };
}

function injectMockComposioClient(service: ComposioService, client: ComposioApiClient): void {
  (service as unknown as { apiClientCache: { key: string; client: ComposioApiClient } | null }).apiClientCache =
    {
      key: TEST_API_KEY,
      client,
    };
}

async function seedOrgWithAdmin(db: ReturnType<typeof createInMemoryDatabaseAdapter>) {
  const now = "2026-01-01T00:00:00.000Z";
  await db.upsertOrganization({
    id: ORG_ID,
    name: "Org",
    slug: "org",
    createdAt: now,
    updatedAt: now,
  });
  await db.createUser({
    id: USER_ID,
    email: "admin@example.com",
    passwordHash: "hash",
    createdAt: now,
    updatedAt: now,
  });
  await db.createUser({
    id: LOCAL_CLIENT_USER_ID,
    email: "local-client@nakama.internal",
    passwordHash: "hash",
    createdAt: now,
    updatedAt: now,
  });
  await db.upsertOrgMember({
    orgId: ORG_ID,
    userId: LOCAL_CLIENT_USER_ID,
    role: "admin",
    createdAt: now,
  });
  await db.upsertOrgMember({
    orgId: ORG_ID,
    userId: USER_ID,
    role: "admin",
    createdAt: "2026-01-01T00:00:01.000Z",
  });
}

async function createConfiguredService() {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-service-"));
  const previous = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await saveComposioConfig({ apiKey: TEST_API_KEY });

  const db = createInMemoryDatabaseAdapter();
  const service = new ComposioService(db, new AuthService());
  injectMockComposioClient(service, createMockClient());

  return {
    db,
    service,
    restore() {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
    },
  };
}

describe("ComposioService", () => {
  test("enableToolkit creates org-scoped toolkit row", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      const toolkit = await service.enableToolkit(ORG_ID, { toolkitSlug: "gmail" });
      expect(toolkit.toolkitSlug).toBe("gmail");
      expect(toolkit.status).toBe("enabled");

      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.orgToolkits).toHaveLength(1);
      expect(listed.userConnections).toEqual([]);
    } finally {
      restore();
    }
  });

  test("connectToolkit stores oauth state on user connection and returns redirect URL", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      await service.enableToolkit(ORG_ID, { toolkitSlug: "gmail" });
      const response = await service.connectToolkit(
        ORG_ID,
        USER_ID,
        "gmail",
        "http://localhost:4310",
      );

      expect(response.redirectUrl).toBe("https://example.com/oauth");
      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.orgToolkits[0]?.status).toBe("enabled");
      expect(listed.userConnections[0]?.status).toBe("oauth_in_progress");
    } finally {
      restore();
    }
  });

  test("listToolkits surfaces catalogError when catalog fetch fails", async () => {
    const { service, restore } = await createConfiguredService();

    injectMockComposioClient(service, {
      ...createMockClient(),
      async listCatalogToolkits() {
        throw new Error("Failed to fetch toolkits");
      },
    });

    try {
      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.configured).toBe(true);
      expect(listed.composioReachable).toBe(false);
      expect(listed.composioAvailable).toBe(false);
      expect(listed.catalogError).toBe("Failed to fetch toolkits");
      expect(listed.catalog).toEqual([]);
      expect(listed.orgToolkits).toEqual([]);
      expect(listed.userConnections).toEqual([]);
    } finally {
      restore();
    }
  });

  test("resolveComposioActingUserId maps local client to earliest human admin", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      await seedOrgWithAdmin(db);
      expect(await service.resolveComposioActingUserId(ORG_ID, LOCAL_CLIENT_USER_ID)).toBe(USER_ID);
      expect(await service.resolveComposioActingUserId(ORG_ID, USER_ID)).toBe(USER_ID);
    } finally {
      restore();
    }
  });

  test("getAssignedToolkitRecords uses admin connections for local client sessions", async () => {
    const { db, service, restore } = await createConfiguredService();
    const now = "2026-01-01T00:00:00.000Z";

    try {
      await seedOrgWithAdmin(db);
      const toolkit = await service.enableToolkit(ORG_ID, { toolkitSlug: "gmail" });
      await db.upsertComposioUserConnection({
        id: "cuc_admin",
        orgId: ORG_ID,
        userId: USER_ID,
        toolkitId: toolkit.id,
        status: "connected",
        connectedAccountId: "ca_admin",
        sessionIdEnc: null,
        oauthStateHash: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      await db.upsertProfile({
        id: "profile_1",
        orgId: ORG_ID,
        name: "Bot",
        model: null,
        systemPrompt: "",
        isDefault: true,
        isSuper: false,
        createdAt: now,
        updatedAt: now,
      });
      await db.replaceProfileComposioToolkits("profile_1", [
        { profileId: "profile_1", toolkitId: toolkit.id, allowedActions: null },
      ]);

      const assigned = await service.getAssignedToolkitRecords(
        ORG_ID,
        LOCAL_CLIENT_USER_ID,
        "profile_1",
      );

      expect(assigned).toHaveLength(1);
      expect(assigned[0]?.userConnection?.status).toBe("connected");
      expect(assigned[0]?.userConnection?.userId).toBe(USER_ID);
    } finally {
      restore();
    }
  });
});
