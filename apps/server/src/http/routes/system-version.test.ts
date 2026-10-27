import { afterEach, describe, expect, mock, test } from "bun:test";
import { getNakamaVersion } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { asTestFetch } from "../../providers/test-helpers";
import { checkNakamaVersion } from "../../services/system-status-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-system-version-routes-test-");

describe("GET /v1/system/version", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("compares the running version with the newest release, platform admins only", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp({
      agent: { listProfiles: async () => ({ profiles: [] }) },
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const admin = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-version@org.com"
    );

    const check = (session: typeof admin, orgId: string) =>
      app.fetch(
        new Request("http://localhost:4310/v1/system/version", {
          headers: session.headers({}, orgId),
        })
      );

    globalThis.fetch = asTestFetch(
      mock(async () => new Response("down", { status: 503 }))
    );

    expect((await check(admin, admin.orgId!)).status).toBe(502);

    globalThis.fetch = asTestFetch(
      mock(async () =>
        Response.json({
          html_url:
            "https://github.com/ahmadrosid/nakama/releases/tag/v999.0.0",
          tag_name: "v999.0.0",
        })
      )
    );

    const response = await check(admin, admin.orgId!);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      current: getNakamaVersion(),
      latest: "999.0.0",
      releaseUrl: "https://github.com/ahmadrosid/nakama/releases/tag/v999.0.0",
      updateAvailable: true,
    });

    const tenantAdmin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "tenant-version@example.com",
      orgId: "version-tenant",
      userId: "user_version_tenant",
    });

    const tenantSession = await loginUserSession(
      app,
      tenantAdmin.email,
      tenantAdmin.password,
      tenantAdmin.orgId
    );

    expect((await check(tenantSession, tenantAdmin.orgId)).status).toBe(403);
  });

  test("only a higher X.Y.Z release counts as an update", async () => {
    globalThis.fetch = asTestFetch(
      mock(async () =>
        Response.json({ html_url: "https://example.com", tag_name: "v0.4.60" })
      )
    );

    // A later clock skips the cached release left by the test above.
    const later = Date.now() + 2 * 60 * 60 * 1000;

    const updates = await Promise.all(
      ["0.4.60", "0.4.59", "0.3.99", "0.4.61", "dev"].map(
        async (current) =>
          (await checkNakamaVersion(current, later)).updateAvailable
      )
    );

    expect(updates).toEqual([false, true, true, false, false]);
  });
});
