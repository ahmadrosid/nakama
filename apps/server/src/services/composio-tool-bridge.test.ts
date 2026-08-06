import { describe, expect, test } from "bun:test";
import {
  buildComposioConnectTools,
  buildComposioToolDefinitions,
  composioConnectionKey,
  namespacedComposioToolName,
} from "./composio-tool-bridge";
import { resolveComposioCallbackBaseUrl } from "./composio-callback-url";
import type { ComposioService } from "./composio-service";
import { McpClientManager } from "./mcp-client-manager";

describe("composio-tool-bridge", () => {
  test("namespaces composio tools", () => {
    expect(namespacedComposioToolName("gmail", "GMAIL_SEND_EMAIL")).toBe(
      "composio__gmail__GMAIL_SEND_EMAIL",
    );
  });

  test("connection key includes user id", () => {
    expect(composioConnectionKey("org_1", "usr_a", "profile_1")).toBe(
      "composio:org_1:usr_a:profile_1",
    );
  });

  test("filters meta tools and disconnected assignments", async () => {
    const composioService = {
      isAvailable: async () => true,
      async getAssignedToolkitRecords() {
        return [
          {
            orgToolkit: {
              id: "ctk_1",
              orgId: "org_1",
              toolkitSlug: "gmail",
              displayName: "Gmail",
              status: "enabled",
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
            userConnection: {
              id: "cuc_1",
              orgId: "org_1",
              userId: "usr_1",
              toolkitId: "ctk_1",
              status: "connected",
              connectedAccountId: "ca_1",
              sessionIdEnc: null,
              oauthStateHash: null,
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
      "usr_1",
      "profile_1",
      composioService,
      manager,
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("composio__gmail__GMAIL_SEND_EMAIL");
  });

  test("returns no tools when user id is missing", async () => {
    const composioService = {
      isAvailable: async () => true,
    } as unknown as ComposioService;
    const manager = new McpClientManager();

    const tools = await buildComposioToolDefinitions(
      "org_1",
      "",
      "profile_1",
      composioService,
      manager,
    );

    expect(tools).toEqual([]);
  });

  test("exposes connect tool when assigned toolkit is not connected", async () => {
    const composioService = {
      isAvailable: async () => true,
      async getAssignedToolkitRecords() {
        return [
          {
            orgToolkit: {
              id: "ctk_1",
              orgId: "org_1",
              toolkitSlug: "gmail",
              displayName: "Gmail",
              status: "enabled",
              cachedTools: [
                {
                  slug: "GMAIL_SEND_EMAIL",
                  name: "Send Email",
                  description: "Send",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              lastError: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: null,
            allowedActions: null,
          },
        ];
      },
      async connectToolkit() {
        return { redirectUrl: "https://oauth.example.com/authorize" };
      },
    } as unknown as ComposioService;

    const tools = await buildComposioConnectTools(
      "org_1",
      "usr_1",
      "profile_1",
      composioService,
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("composio__connect_account");

    const result = await tools[0]?.run(
      { toolkit_slug: "gmail" },
      { clientOrigin: "https://nakama.example.com" },
    );
    expect(result).toMatchObject({
      toolkitSlug: "gmail",
      displayName: "Gmail",
      redirectUrl: "https://oauth.example.com/authorize",
    });
  });

  test("connect tool rejects loopback callback URLs", async () => {
    const composioService = {
      isAvailable: async () => true,
      async getAssignedToolkitRecords() {
        return [
          {
            orgToolkit: {
              id: "ctk_1",
              orgId: "org_1",
              toolkitSlug: "gmail",
              displayName: "Gmail",
              status: "enabled",
              cachedTools: [],
              lastError: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: null,
            allowedActions: null,
          },
        ];
      },
      async connectToolkit() {
        throw new Error("should not be called");
      },
    } as unknown as ComposioService;

    const tools = await buildComposioConnectTools(
      "org_1",
      "usr_1",
      "profile_1",
      composioService,
    );

    const result = await tools[0]?.run(
      { toolkit_slug: "gmail" },
      { clientOrigin: "http://127.0.0.1:3003" },
    );

    expect(result).toMatchObject({
      code: "COMPOSIO_POLICY",
      toolkitSlug: "gmail",
    });
    expect(String((result as { error?: string }).error)).toContain("localhost");
  });

  test("resolveComposioCallbackBaseUrl prefers clientOrigin from browser", () => {
    expect(
      resolveComposioCallbackBaseUrl({ clientOrigin: "https://app.example.com/" }),
    ).toBe("https://app.example.com");
  });

  test("resolveComposioCallbackBaseUrl reads Origin header from request", () => {
    const request = new Request("http://127.0.0.1:4310/v1/sessions/s1/messages", {
      headers: { Origin: "http://localhost:3003" },
    });

    expect(resolveComposioCallbackBaseUrl({ request })).toBe("http://localhost:3003");
  });
});
