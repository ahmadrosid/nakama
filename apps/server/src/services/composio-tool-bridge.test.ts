import { describe, expect, test } from "bun:test";
import { resolveComposioCallbackBaseUrl } from "./composio-callback-url";
import type { ComposioService } from "./composio-service";
import {
  buildComposioConnectTools,
  buildComposioToolDefinitions,
  composioConnectionKey,
} from "./composio-tool-bridge";
import { McpClientManager } from "./mcp-client-manager";

describe("composio-tool-bridge", () => {
  test("connection key includes user id", () => {
    expect(composioConnectionKey("org_1", "usr_a", "profile_1")).toBe(
      "composio:org_1:usr_a:profile_1"
    );
  });

  test("exposes search + invoke meta-tools for connected assignments", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "Send an email",
                  inputSchema: { properties: {}, type: "object" },
                  name: "Send Email",
                  slug: "GMAIL_SEND_EMAIL",
                },
                {
                  description: "Manage",
                  inputSchema: { properties: {}, type: "object" },
                  name: "Manage",
                  slug: "COMPOSIO_MANAGE_CONNECTIONS",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
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
      manager
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "composio__search_actions",
      "composio__invoke_action",
    ]);

    const searchResult = await tools[0]?.run({ query: "send" }, {});
    expect(searchResult).toMatchObject({ count: 1 });
    expect(
      (searchResult as { actions: Array<{ action_slug: string }> }).actions[0]
    ).toMatchObject({
      action_slug: "GMAIL_SEND_EMAIL",
      toolkit_slug: "gmail",
    });
  });

  test("search returns all actions for empty query and filters by toolkit_slug", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "send",
                  inputSchema: {},
                  name: "Send",
                  slug: "GMAIL_SEND_EMAIL",
                },
                {
                  description: "fetch",
                  inputSchema: {},
                  name: "Fetch",
                  slug: "GMAIL_FETCH_EMAILS",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
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
      manager
    );

    const allResult = await tools[0]?.run({ query: "" }, {});
    expect((allResult as { count: number }).count).toBe(2);

    const scopedResult = await tools[0]?.run(
      { query: "", toolkit_slug: "gmail" },
      {}
    );
    expect((scopedResult as { count: number }).count).toBe(2);

    const noneResult = await tools[0]?.run(
      { query: "", toolkit_slug: "slack" },
      {}
    );
    expect((noneResult as { count: number }).count).toBe(0);
  });

  test("invoke rejects actions not in allowedActions", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: ["GMAIL_SEND_EMAIL"],
            orgToolkit: {
              cachedTools: [
                {
                  description: "send",
                  inputSchema: {},
                  name: "Send",
                  slug: "GMAIL_SEND_EMAIL",
                },
                {
                  description: "delete",
                  inputSchema: {},
                  name: "Delete",
                  slug: "GMAIL_DELETE_EMAIL",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
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
      manager
    );

    const allowed = await tools[1]?.run(
      { action_slug: "GMAIL_SEND_EMAIL", arguments: {}, toolkit_slug: "gmail" },
      {}
    );
    expect(allowed).toEqual({ ok: true });

    const blocked = await tools[1]?.run(
      {
        action_slug: "GMAIL_DELETE_EMAIL",
        arguments: {},
        toolkit_slug: "gmail",
      },
      {}
    );
    expect(blocked).toMatchObject({
      code: "COMPOSIO_POLICY",
      toolkitSlug: "gmail",
    });
  });

  test("invoke truncates large tool results", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "fetch",
                  inputSchema: {},
                  name: "Fetch",
                  slug: "GMAIL_FETCH_EMAILS",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
    } as unknown as ComposioService;

    const bigPayload = {
      messages: Array.from({ length: 5000 }, (_, i) => ({
        body: "x".repeat(50),
        id: i,
      })),
    };
    const manager = new McpClientManager();
    manager.connectHttpEndpoint = async () => [];
    manager.isHttpEndpointConnected = () => true;
    manager.callHttpEndpointTool = async () => bigPayload;

    const tools = await buildComposioToolDefinitions(
      "org_1",
      "usr_1",
      "profile_1",
      composioService,
      manager
    );

    const result = (await tools[1]?.run(
      {
        action_slug: "GMAIL_FETCH_EMAILS",
        arguments: {},
        toolkit_slug: "gmail",
      },
      {}
    )) as { truncated?: boolean; content?: string };

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("[truncated]");
  });

  test("invoke matches action slug case-insensitively", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "send",
                  inputSchema: {},
                  name: "Send",
                  slug: "GMAIL_SEND_EMAIL",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
    } as unknown as ComposioService;

    const manager = new McpClientManager();
    manager.connectHttpEndpoint = async () => [];
    manager.isHttpEndpointConnected = () => true;
    manager.callHttpEndpointTool = async (key, slug) => ({ invoked: slug });

    const tools = await buildComposioToolDefinitions(
      "org_1",
      "usr_1",
      "profile_1",
      composioService,
      manager
    );

    const lowerSlug = (await tools[1]?.run(
      { action_slug: "gmail_send_email", arguments: {}, toolkit_slug: "Gmail" },
      {}
    )) as { invoked?: string };
    expect(lowerSlug.invoked).toBe("GMAIL_SEND_EMAIL");
  });

  test("invoke defaults missing arguments to empty object", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "send",
                  inputSchema: {},
                  name: "Send",
                  slug: "GMAIL_SEND_EMAIL",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: {
              connectedAccountId: "ca_1",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: "cuc_1",
              lastError: null,
              oauthStateHash: null,
              orgId: "org_1",
              sessionIdEnc: null,
              status: "connected",
              toolkitId: "ctk_1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "usr_1",
            },
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
    } as unknown as ComposioService;

    const manager = new McpClientManager();
    manager.connectHttpEndpoint = async () => [];
    manager.isHttpEndpointConnected = () => true;
    manager.callHttpEndpointTool = async (_key, _slug, args) => ({
      receivedArgs: args,
    });

    const tools = await buildComposioToolDefinitions(
      "org_1",
      "usr_1",
      "profile_1",
      composioService,
      manager
    );

    const result = (await tools[1]?.run(
      { action_slug: "GMAIL_SEND_EMAIL", toolkit_slug: "gmail" } as Record<
        string,
        unknown
      >,
      {}
    )) as { receivedArgs?: Record<string, unknown> };
    expect(result.receivedArgs).toEqual({});
  });

  test("returns no tools when an assigned toolkit is not connected", async () => {
    const composioService = {
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "send",
                  inputSchema: {},
                  name: "Send",
                  slug: "GMAIL_SEND_EMAIL",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: null,
          },
        ];
      },
      async getProfileSessionEndpoint() {
        return {
          headers: {},
          sessionId: "sess_1",
          url: "https://mcp.example.com",
        };
      },
      isAvailable: async () => true,
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
      manager
    );

    // The toolkit is assigned but not connected, so buildComposioToolDefinitions returns []
    // (connectedAssignments filter excludes it). Verify no tools are exposed.
    expect(tools).toEqual([]);
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
      manager
    );

    expect(tools).toEqual([]);
  });

  test("exposes connect tool when assigned toolkit is not connected", async () => {
    const composioService = {
      async connectToolkit() {
        return { redirectUrl: "https://oauth.example.com/authorize" };
      },
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [
                {
                  description: "Send",
                  inputSchema: { properties: {}, type: "object" },
                  name: "Send Email",
                  slug: "GMAIL_SEND_EMAIL",
                },
              ],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: null,
          },
        ];
      },
      isAvailable: async () => true,
    } as unknown as ComposioService;

    const tools = await buildComposioConnectTools(
      "org_1",
      "usr_1",
      "profile_1",
      composioService
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("composio__connect_account");

    const result = await tools[0]?.run(
      { toolkit_slug: "gmail" },
      { clientOrigin: "https://nakama.example.com" }
    );
    expect(result).toMatchObject({
      displayName: "Gmail",
      redirectUrl: "https://oauth.example.com/authorize",
      toolkitSlug: "gmail",
    });
  });

  test("connect tool rejects loopback callback URLs", async () => {
    const composioService = {
      async connectToolkit() {
        throw new Error("should not be called");
      },
      async getAssignedToolkitRecords() {
        return [
          {
            allowedActions: null,
            orgToolkit: {
              cachedTools: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              displayName: "Gmail",
              id: "ctk_1",
              lastError: null,
              orgId: "org_1",
              status: "enabled",
              toolkitSlug: "gmail",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            userConnection: null,
          },
        ];
      },
      isAvailable: async () => true,
    } as unknown as ComposioService;

    const tools = await buildComposioConnectTools(
      "org_1",
      "usr_1",
      "profile_1",
      composioService
    );

    const result = await tools[0]?.run(
      { toolkit_slug: "gmail" },
      { clientOrigin: "http://127.0.0.1:3003" }
    );

    expect(result).toMatchObject({
      code: "COMPOSIO_POLICY",
      toolkitSlug: "gmail",
    });
    expect(String((result as { error?: string }).error)).toContain("localhost");
  });

  test("resolveComposioCallbackBaseUrl prefers clientOrigin from browser", () => {
    expect(
      resolveComposioCallbackBaseUrl({
        clientOrigin: "https://app.example.com/",
      })
    ).toBe("https://app.example.com");
  });

  test("resolveComposioCallbackBaseUrl reads Origin header from request", () => {
    const request = new Request(
      "http://127.0.0.1:4310/v1/sessions/s1/messages",
      {
        headers: { Origin: "http://localhost:3003" },
      }
    );

    expect(resolveComposioCallbackBaseUrl({ request })).toBe(
      "http://localhost:3003"
    );
  });
});
