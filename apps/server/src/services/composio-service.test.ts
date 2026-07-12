import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveComposioConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import { ComposioService } from "./composio-service";
import type { ComposioApiClient } from "./composio-api-client";

const TEST_API_KEY = "ck_test";
const USER_ID = "user_admin";

function createMockClient(): ComposioApiClient {
  return {
    async listCatalogToolkits() {
      return [{ slug: "gmail", name: "Gmail", description: "Google Mail", logoUrl: null }];
    },
    async linkToolkitAccount(_userId, _toolkitSlug) {
      return { redirectUrl: "https://example.com/oauth", connectedAccountId: "ca_1" };
    },
    async deleteConnectedAccount() {},
    async createProfileSession(userId) {
      expect(userId).toBe("nakama:user:user_admin");
      return {
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
        headers: { Authorization: "Bearer test" },
      };
    },
    async reuseProfileSession() {
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
      const toolkit = await service.enableToolkit("org_1", { toolkitSlug: "gmail" });
      expect(toolkit.toolkitSlug).toBe("gmail");
      expect(toolkit.status).toBe("enabled");

      const listed = await service.listToolkits("org_1", USER_ID);
      expect(listed.orgToolkits).toHaveLength(1);
      expect(listed.userConnections).toEqual([]);
    } finally {
      restore();
    }
  });

  test("connectToolkit stores oauth state on user connection and returns redirect URL", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      await service.enableToolkit("org_1", { toolkitSlug: "gmail" });
      const response = await service.connectToolkit(
        "org_1",
        USER_ID,
        "gmail",
        "http://localhost:4310",
      );

      expect(response.redirectUrl).toBe("https://example.com/oauth");
      const listed = await service.listToolkits("org_1", USER_ID);
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
      const listed = await service.listToolkits("org_1", USER_ID);
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
});
