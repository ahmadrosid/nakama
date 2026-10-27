import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    delete process.env.NAKAMA_DISABLE_UPDATE_CHECK;
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

  test("NAKAMA_DISABLE_UPDATE_CHECK answers 404 without calling GitHub", async () => {
    process.env.NAKAMA_DISABLE_UPDATE_CHECK = "true";

    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: { listProfiles: async () => ({ profiles: [] }) },
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const admin = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-version-off@org.com"
    );

    const github = mock(async () => Response.json({}));
    globalThis.fetch = asTestFetch(github);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/system/version", {
        headers: admin.headers({}, admin.orgId!),
      })
    );

    expect(response.status).toBe(404);
    expect(github).not.toHaveBeenCalled();

    const health = await app.fetch(new Request("http://localhost:4310/health"));
    expect((await health.json()).updateCheckEnabled).toBe(false);
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

  test("the Update button hands a newer version to a running updater, platform admins only", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp({
      agent: { listProfiles: async () => ({ profiles: [] }) },
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const admin = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-upgrade@org.com"
    );

    const upgrade = (session: typeof admin, orgId: string, version: string) =>
      app.fetch(
        new Request("http://localhost:4310/v1/system/upgrade", {
          body: JSON.stringify({ version }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "POST",
        })
      );

    const dir = mkdtempSync(join(tmpdir(), "nakama-updates-"));

    process.env.NAKAMA_UPDATER_DIR = dir;

    try {
      expect((await upgrade(admin, admin.orgId!, "999.0.0")).status).toBe(409);

      writeFileSync(join(dir, "heartbeat"), "");

      expect((await upgrade(admin, admin.orgId!, "latest")).status).toBe(400);
      expect((await upgrade(admin, admin.orgId!, "0.0.1")).status).toBe(400);
      expect((await upgrade(admin, admin.orgId!, "999.0.0")).status).toBe(202);
      expect(readFileSync(join(dir, "request"), "utf8")).toBe("999.0.0\n");

      writeFileSync(
        join(dir, "status.json"),
        JSON.stringify({
          at: "2026-10-27T00:00:00Z",
          message: "Starting 999.0.0.",
          state: "running",
          version: "999.0.0",
        })
      );

      expect((await upgrade(admin, admin.orgId!, "999.0.0")).status).toBe(409);

      const tenantAdmin = await seedOrgAdmin(databaseAdapter, {
        authService,
        email: "tenant-upgrade@example.com",
        orgId: "upgrade-tenant",
        userId: "user_upgrade_tenant",
      });

      const tenantSession = await loginUserSession(
        app,
        tenantAdmin.email,
        tenantAdmin.password,
        tenantAdmin.orgId
      );

      expect(
        (await upgrade(tenantSession, tenantAdmin.orgId, "999.0.0")).status
      ).toBe(403);
    } finally {
      delete process.env.NAKAMA_UPDATER_DIR;
    }
  });
});
