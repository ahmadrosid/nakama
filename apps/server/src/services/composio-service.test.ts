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

function createMockClient(): ComposioApiClient {
  return {
    async listCatalogToolkits() {
      return [{ slug: "gmail", name: "Gmail", description: "Google Mail" }];
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

      const listed = await service.listToolkits("org_1");
      expect(listed.orgToolkits).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("connectToolkit stores oauth state and returns redirect URL", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      await service.enableToolkit("org_1", { toolkitSlug: "gmail" });
      const response = await service.connectToolkit(
        "org_1",
        "gmail",
        "http://localhost:4310",
      );

      expect(response.redirectUrl).toBe("https://example.com/oauth");
      const listed = await service.listToolkits("org_1");
      expect(listed.orgToolkits[0]?.status).toBe("oauth_in_progress");
    } finally {
      restore();
    }
  });
});
