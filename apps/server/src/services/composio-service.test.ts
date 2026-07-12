import { describe, expect, test } from "bun:test";
import { AuthService } from "./auth-service";
import { ComposioService } from "./composio-service";
import type { ComposioApiClient } from "./composio-api-client";
import { createInMemoryDatabaseAdapter } from "@nakama/db";

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

describe("ComposioService", () => {
  test("enableToolkit creates org-scoped toolkit row", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new ComposioService(db, new AuthService(), { COMPOSIO_API_KEY: "ck_test" });
    (service as unknown as { apiClient: ComposioApiClient }).apiClient = createMockClient();

    const toolkit = await service.enableToolkit("org_1", { toolkitSlug: "gmail" });
    expect(toolkit.toolkitSlug).toBe("gmail");
    expect(toolkit.status).toBe("enabled");

    const listed = await service.listToolkits("org_1");
    expect(listed.orgToolkits).toHaveLength(1);
  });

  test("connectToolkit stores oauth state and returns redirect URL", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new ComposioService(db, new AuthService(), { COMPOSIO_API_KEY: "ck_test" });
    (service as unknown as { apiClient: ComposioApiClient }).apiClient = createMockClient();

    await service.enableToolkit("org_1", { toolkitSlug: "gmail" });
    const response = await service.connectToolkit(
      "org_1",
      "gmail",
      "http://localhost:4310",
    );

    expect(response.redirectUrl).toBe("https://example.com/oauth");
    const listed = await service.listToolkits("org_1");
    expect(listed.orgToolkits[0]?.status).toBe("oauth_in_progress");
  });
});
