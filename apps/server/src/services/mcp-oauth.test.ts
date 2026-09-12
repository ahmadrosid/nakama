import { afterAll, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { McpClientManager } from "./mcp-client-manager";
import { readMcpOAuthGrant } from "./mcp-oauth";
import { McpService } from "./mcp-service";

const ACCESS_TOKEN = "fake-access-token";
const CALLBACK_BASE_URL = "http://127.0.0.1:4310";

/**
 * A remote MCP server that answers 401 until it sees a Bearer token, fronted by
 * the OAuth endpoints the MCP authorization spec discovers: protected resource
 * metadata, authorization server metadata, dynamic registration, token.
 */
function startOAuthProtectedMcpServer() {
  // Stateless mode refuses a reused transport, so every MCP request gets its own.
  async function handleMcpRequest(request: Request): Promise<Response> {
    const mcp = new McpServer({ name: "fake-remote", version: "1.0.0" });
    mcp.registerTool("echo", { description: "Echo a value" }, () => ({
      content: [{ text: "ok", type: "text" as const }],
    }));

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    await mcp.connect(transport);

    return await transport.handleRequest(request);
  }

  const tokenRequests: URLSearchParams[] = [];

  const server = Bun.serve({
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return Response.json({
          authorization_servers: [url.origin],
          resource: `${url.origin}/mcp`,
        });
      }

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          authorization_endpoint: `${url.origin}/authorize`,
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          issuer: url.origin,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          token_endpoint: `${url.origin}/token`,
        });
      }

      if (url.pathname === "/register" && request.method === "POST") {
        return Response.json(
          {
            ...((await request.json()) as Record<string, unknown>),
            client_id: "fake-client-id",
          },
          { status: 201 }
        );
      }

      if (url.pathname === "/token" && request.method === "POST") {
        tokenRequests.push(new URLSearchParams(await request.text()));

        return Response.json({
          access_token: ACCESS_TOKEN,
          expires_in: 3600,
          refresh_token: "fake-refresh-token",
          token_type: "Bearer",
        });
      }

      if (url.pathname === "/mcp") {
        if (request.headers.get("authorization") !== `Bearer ${ACCESS_TOKEN}`) {
          return Response.json(
            { error: "unauthorized" },
            {
              headers: {
                "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
              },
              status: 401,
            }
          );
        }

        return await handleMcpRequest(request);
      }

      return new Response("not found", { status: 404 });
    },
    port: 0,
  });

  return {
    stop: () => server.stop(true),
    tokenRequests,
    url: `http://127.0.0.1:${server.port}/mcp`,
  };
}

const remote = startOAuthProtectedMcpServer();

afterAll(async () => {
  await remote.stop();
});

describe("MCP browser authorization", () => {
  test("hands back an authorization URL, then connects from the callback", async () => {
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer(
      {
        config: { url: remote.url },
        connect: true,
        name: "fake-remote",
        transport: "http",
      },
      { callbackBaseUrl: CALLBACK_BASE_URL }
    );

    const authorizationUrl = created.authorizationUrl;

    if (!authorizationUrl) {
      throw new Error("expected an authorization URL");
    }

    const redirectUri = `${CALLBACK_BASE_URL}/v1/mcp/oauth/callback/${created.server.id}`;
    const authorizeParams = new URL(authorizationUrl).searchParams;
    const state = authorizeParams.get("state");

    expect(created.server.status).toBe("needs_auth");
    expect(created.server.lastError).toBeNull();
    expect(created.server.toolCount).toBe(0);
    expect(authorizeParams.get("redirect_uri")).toBe(redirectUri);
    expect(authorizeParams.get("code_challenge")).toBeTruthy();
    expect(state).toBeTruthy();

    await expect(
      service.completeOAuth(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
        code: "fake-auth-code",
        state: "not-the-state",
      })
    ).rejects.toThrow();
    // A refused state exchanges nothing.
    expect(remote.tokenRequests).toHaveLength(0);

    const completed = await service.completeOAuth(created.server.id, {
      callbackBaseUrl: CALLBACK_BASE_URL,
      code: "fake-auth-code",
      state: state as string,
    });

    expect(completed.server.status).toBe("connected");
    expect(completed.server.lastError).toBeNull();
    expect(completed.server.cachedTools.map((tool) => tool.name)).toContain(
      "echo"
    );
    // The grant is a secret: the API response only carries url and headers.
    expect(JSON.stringify(completed.server.config)).not.toContain(ACCESS_TOKEN);

    const exchange = remote.tokenRequests.at(-1);
    expect(exchange?.get("code")).toBe("fake-auth-code");
    expect(exchange?.get("redirect_uri")).toBe(redirectUri);
    expect(exchange?.get("code_verifier")).toBeTruthy();

    const stored = await db.getMcpServer(created.server.id);
    const grant = readMcpOAuthGrant(stored?.config);
    expect(grant?.tokens?.access_token).toBe(ACCESS_TOKEN);
    expect(grant?.clientInformation?.client_id).toBe("fake-client-id");
    // Single use: the callback spent the state and the verifier.
    expect(grant?.state).toBeUndefined();
    expect(grant?.codeVerifier).toBeUndefined();

    await manager.disconnectAll();
  });

  test("reports a sign-in requirement from a test instead of a failure", async () => {
    const service = new McpService(
      createInMemoryDatabaseAdapter(),
      new McpClientManager()
    );

    const needsSignIn = await service.testServer("http", { url: remote.url });
    expect(needsSignIn.ok).toBe(false);
    expect(needsSignIn.requiresAuthorization).toBe(true);

    // A server that is simply unreachable must not be dressed up as a sign-in.
    const broken = await service.testServer("http", {
      url: "http://127.0.0.1:1/mcp",
    });
    expect(broken.ok).toBe(false);
    expect(broken.requiresAuthorization).toBeUndefined();
  });

  test("keeps the grant while the endpoint is unchanged and drops it when it moves", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new McpService(db, new McpClientManager());

    const created = await service.createServer({
      config: { url: "https://mcp.example.com/mcp" },
      connect: false,
      name: "stored-grant",
      transport: "http",
    });
    const stored = await db.getMcpServer(created.server.id);

    if (!stored) {
      throw new Error("expected a stored server");
    }

    await db.upsertMcpServer({
      ...stored,
      config: {
        ...(stored.config as Record<string, unknown>),
        oauth: { tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer" } },
      },
    });

    await service.updateServer(created.server.id, {
      config: {
        headers: { "X-Extra": "value" },
        url: "https://mcp.example.com/mcp",
      },
    });
    expect(
      readMcpOAuthGrant((await db.getMcpServer(created.server.id))?.config)
        ?.tokens?.access_token
    ).toBe(ACCESS_TOKEN);

    await service.updateServer(created.server.id, {
      config: { url: "https://other.example.com/mcp" },
    });
    expect(
      readMcpOAuthGrant((await db.getMcpServer(created.server.id))?.config)
    ).toBeUndefined();
  });
});
