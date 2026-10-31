import { afterEach, describe, expect, mock, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { asTestFetch } from "../../providers/test-helpers";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-mcp-registry-routes-test-");

const BASE = "http://localhost:4310";

function createApp() {
  return createMinimalHonoApp({
    agent: { listProfiles: async () => ({ profiles: [] }) },
    databaseAdapter: createInMemoryDatabaseAdapter(),
  });
}

describe("MCP official registry search", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("search returns remote servers to platform admins only", async () => {
    let requestedUrl = "";
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      mock(async (input) => {
        requestedUrl = String(input);

        return Response.json({
          servers: [
            {
              server: {
                description: "GitHub MCP Server",
                name: "github-mcp",
                remotes: [
                  {
                    headers: [
                      {
                        description: "API Key",
                        isRequired: true,
                        isSecret: true,
                        name: "Authorization",
                        value: "Bearer {token}",
                      },
                      {
                        name: "X-Custom-Header",
                        value: "fixed-value",
                      },
                    ],
                    type: "streamable-http",
                    url: "https://example.com/mcp",
                  },
                ],
              },
            },
            {
              server: {
                description: "Local package only",
                name: "local-only",
                packages: [{ registryType: "npm" }],
              },
            },
          ],
        });
      })
    );

    const { app, authService, databaseAdapter } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-mcp@org.com"
    );

    const search = (session: typeof adminSession, orgId: string) =>
      app.fetch(
        new Request(`${BASE}/v1/mcp/registry?search=github`, {
          headers: session.headers({}, orgId),
        })
      );

    const response = await search(adminSession, adminSession.orgId!);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      servers: [
        {
          description: "GitHub MCP Server",
          name: "github-mcp",
          remotes: [
            {
              headers: [
                {
                  description: "API Key",
                  isRequired: true,
                  isSecret: true,
                  name: "Authorization",
                  value: "Bearer {token}",
                },
                {
                  name: "X-Custom-Header",
                  value: "fixed-value",
                },
              ],
              type: "streamable-http",
              url: "https://example.com/mcp",
            },
          ],
          transport: "streamable-http",
        },
      ],
    });
    expect(new URL(requestedUrl).searchParams.get("search")).toBe("github");

    const tenantAdmin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "tenant-mcp@example.com",
      orgId: "mcp-tenant",
      userId: "user_mcp_tenant",
    });

    const tenantSession = await loginUserSession(
      app,
      tenantAdmin.email,
      tenantAdmin.password,
      tenantAdmin.orgId
    );

    expect((await search(tenantSession, tenantAdmin.orgId)).status).toBe(403);

    globalThis.fetch = asTestFetch(
      mock(async () => new Response("down", { status: 503 }))
    );

    expect((await search(adminSession, adminSession.orgId!)).status).toBe(502);
  });

  test("empty query or short query returns empty list without calling upstream", async () => {
    let called = false;
    globalThis.fetch = asTestFetch(
      mock(async () => {
        called = true;

        return Response.json({ servers: [] });
      })
    );

    const { app, databaseAdapter } = createApp();

    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-mcp-short@org.com"
    );

    const response = await app.fetch(
      new Request(`${BASE}/v1/mcp/registry?search=a`, {
        headers: adminSession.headers({}, adminSession.orgId!),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ servers: [] });
    expect(called).toBe(false);
  });
});
