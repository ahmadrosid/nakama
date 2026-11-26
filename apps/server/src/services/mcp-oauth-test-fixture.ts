import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const ACCESS_TOKEN = "fake-access-token";

/**
 * A remote MCP server that answers 401 until it sees a Bearer token, fronted by
 * the OAuth endpoints the MCP authorization spec discovers: protected resource
 * metadata, authorization server metadata, dynamic registration, token.
 */
export function startOAuthProtectedMcpServer() {
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
  const clients = new Map<string, string[]>();

  const challenges = new Map<
    string,
    { challenge: string; redirectUri: string }
  >();

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
        const registration = z
          .object({ redirect_uris: z.array(z.string()) })
          .catchall(z.json())
          .parse(await request.json());

        const clientId = `fake-client-${clients.size + 1}`;
        clients.set(clientId, registration.redirect_uris);

        return Response.json(
          { ...registration, client_id: clientId },
          { status: 201 }
        );
      }

      if (url.pathname === "/token" && request.method === "POST") {
        const parameters = new URLSearchParams(await request.text());
        tokenRequests.push(parameters);
        const code = parameters.get("code") ?? "";
        const expected = challenges.get(code);

        if (parameters.get("refresh_token") === "unavailable-refresh-token") {
          return Response.json({ error: "server_error" }, { status: 500 });
        }

        if (
          code.startsWith("issued-") &&
          (!expected ||
            createHash("sha256")
              .update(parameters.get("code_verifier") ?? "")
              .digest("base64url") !== expected.challenge ||
            parameters.get("redirect_uri") !== expected.redirectUri)
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }

        // Like a real provider: the redirect must be one the client registered.
        const redirectUri = parameters.get("redirect_uri");

        if (
          redirectUri &&
          !clients.get(parameters.get("client_id") ?? "")?.includes(redirectUri)
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }

        challenges.delete(code);

        return Response.json({
          access_token: ACCESS_TOKEN,
          expires_in: 3600,
          refresh_token: "fake-refresh-token",
          token_type: "Bearer",
        });
      }

      const signedIn =
        request.headers.get("authorization") === `Bearer ${ACCESS_TOKEN}`;

      const unauthorized = () =>
        Response.json(
          { error: "unauthorized" },
          {
            headers: {
              "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
            },
            status: 401,
          }
        );

      if (url.pathname === "/mcp") {
        return signedIn ? await handleMcpRequest(request) : unauthorized();
      }

      // Lists its tools to anyone and asks for a token only on a tool call, so
      // connecting alone never meets the 401 that starts a sign-in.
      if (url.pathname === "/mcp/open") {
        const body = await request
          .clone()
          .json()
          .catch(() => null);

        const isToolCall =
          z.object({ method: z.string() }).safeParse(body).data?.method ===
          "tools/call";

        return isToolCall && !signedIn
          ? unauthorized()
          : await handleMcpRequest(request);
      }

      return new Response("not found", { status: 404 });
    },
    port: 0,
  });

  return {
    clients,
    issueCode(authorizationUrl: string) {
      const params = new URL(authorizationUrl).searchParams;
      const code = `issued-${params.get("state")}`;
      challenges.set(code, {
        challenge: z.string().parse(params.get("code_challenge")),
        redirectUri: z.string().parse(params.get("redirect_uri")),
      });

      return code;
    },
    openUrl: `http://127.0.0.1:${server.port}/mcp/open`,
    stop: () => server.stop(true),
    tokenRequests,
    url: `http://127.0.0.1:${server.port}/mcp`,
  };
}
