import { describe, expect, test } from "bun:test";
import {
  buildComposioToolDefinitions,
  namespacedComposioToolName,
} from "./composio-tool-bridge";
import type { ComposioService } from "./composio-service";
import { McpClientManager } from "./mcp-client-manager";

describe("composio-tool-bridge", () => {
  test("namespaces composio tools", () => {
    expect(namespacedComposioToolName("gmail", "GMAIL_SEND_EMAIL")).toBe(
      "composio__gmail__GMAIL_SEND_EMAIL",
    );
  });

  test("filters meta tools and disconnected assignments", async () => {
    const composioService = {
      isAvailable: async () => true,
      async getAssignedToolkitRecords() {
        return [
          {
            toolkit: {
              id: "ctk_1",
              orgId: "org_1",
              toolkitSlug: "gmail",
              displayName: "Gmail",
              status: "connected",
              connectedAccountId: "ca_1",
              sessionIdEnc: null,
              oauthStateHash: null,
              cachedTools: [
                {
                  slug: "GMAIL_SEND_EMAIL",
                  name: "Send Email",
                  description: "Send",
                  inputSchema: { type: "object", properties: {} },
                },
                {
                  slug: "COMPOSIO_MANAGE_CONNECTIONS",
                  name: "Manage",
                  description: "Manage",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              lastError: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            allowedActions: null,
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          sessionId: "sess_1",
          url: "https://mcp.example.com",
          headers: {},
        };
      },
    } as unknown as ComposioService;

    const manager = new McpClientManager();
    manager.connectHttpEndpoint = async () => [];
    manager.isHttpEndpointConnected = () => true;
    manager.callHttpEndpointTool = async () => ({ ok: true });

    const tools = await buildComposioToolDefinitions(
      "org_1",
      "profile_1",
      composioService,
      manager,
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("composio__gmail__GMAIL_SEND_EMAIL");
  });
});
