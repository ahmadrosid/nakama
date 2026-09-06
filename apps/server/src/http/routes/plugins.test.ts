import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@nakama/core";
import { getUserConfigDir, PLUGIN_MANIFEST_API_VERSION } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { zipSync } from "fflate";
import type { AuthService } from "../../services/auth-service";
import { PluginService } from "../../services/plugin-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-plugins-http-");

const PASSWORD = "password123";
const echoJs = `
export async function run(input) {
  return { ok: true, input };
}
`;

function pluginBundle(
  version = "1.0.0",
  extras: Record<string, string> = {}
): Uint8Array {
  const manifest = {
    actions: [
      {
        access: "member",
        description: "List notes",
        effect: "read",
        entry: "actions/list.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "list",
      },
      {
        access: "admin",
        description: "Wipe notes",
        effect: "write",
        entry: "actions/wipe.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "wipe",
      },
    ],
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    author: "Nakama",
    description: "Notes",
    id: "notes",
    license: "MIT",
    minNakamaVersion: "0.1.0",
    name: "Notes",
    skills: [],
    ui: {
      assetsDir: "ui/assets",
      entryHtml: "ui/index.html",
      pageLabel: "Notes",
    },
    version,
  };
  return zipSync({
    "actions/list.js": Buffer.from(echoJs),
    "actions/wipe.js": Buffer.from(echoJs),
    "hooks/activate.js": Buffer.from(echoJs),
    "migrations/001.sql": Buffer.from("SELECT 1;"),
    "nakama.plugin.json": Buffer.from(JSON.stringify(manifest)),
    "secret.txt": Buffer.from("backend-secret"),
    "ui/assets/app.js": Buffer.from("export {}"),
    "ui/index.html": Buffer.from("<html><body>notes</body></html>"),
    ...Object.fromEntries(
      Object.entries(extras).map(([key, value]) => [key, Buffer.from(value)])
    ),
  });
}

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const pluginService = new PluginService(databaseAdapter, getUserConfigDir());
  return {
    ...createMinimalHonoApp({ databaseAdapter, pluginService }),
    pluginService,
  };
}

async function seedUser(
  databaseAdapter: DatabaseAdapter,
  authService: AuthService,
  input: {
    email: string;
    isPlatformAdmin?: boolean;
    orgId?: string;
    role?: OrgRole;
    userId: string;
  }
) {
  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email: input.email,
    id: input.userId,
    isPlatformAdmin: input.isPlatformAdmin,
    passwordHash: await authService.hashPassword(PASSWORD),
    updatedAt: now,
  });
  if (input.orgId && input.role) {
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: input.orgId,
      role: input.role,
      userId: input.userId,
    });
  }
}

async function jsonRequest(
  app: { fetch: typeof fetch },
  path: string,
  session: TestBrowserSession | null,
  init: RequestInit = {},
  orgId?: string | ""
) {
  const headers = session
    ? session.headers(
        {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.method && init.method !== "GET"
            ? { "X-CSRF-Token": session.csrfToken }
            : {}),
          ...((init.headers as Record<string, string>) ?? {}),
        },
        orgId
      )
    : ((init.headers as Record<string, string>) ?? {});
  return app.fetch(
    new Request(`http://localhost:4310${path}`, {
      ...init,
      headers,
    })
  );
}

async function installRelease(
  app: { fetch: typeof fetch },
  platform: TestBrowserSession,
  archive = pluginBundle()
) {
  const response = await jsonRequest(
    app,
    "/v1/platform/plugins/releases",
    platform,
    {
      body: JSON.stringify({ data: Buffer.from(archive).toString("base64") }),
      method: "POST",
    }
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{ pluginId: string; version: string }>;
}

describe("plugin HTTP API", () => {
  test("AE6 authority matrix for platform, org roles, nonmember, and archived org", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const installer = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = installer.orgId!;

    await seedUser(databaseAdapter, authService, {
      email: "org-admin@example.com",
      orgId,
      role: "admin",
      userId: "user_org_admin",
    });
    await seedUser(databaseAdapter, authService, {
      email: "member@example.com",
      orgId,
      role: "member",
      userId: "user_member",
    });
    await seedUser(databaseAdapter, authService, {
      email: "viewer@example.com",
      orgId,
      role: "viewer",
      userId: "user_viewer",
    });
    await seedUser(databaseAdapter, authService, {
      email: "outsider@example.com",
      userId: "user_outsider",
    });
    await seedUser(databaseAdapter, authService, {
      email: "archived@example.com",
      orgId: "org_archived",
      role: "admin",
      userId: "user_archived",
    });
    const now = new Date().toISOString();
    await databaseAdapter.upsertOrganization({
      archivedAt: now,
      createdAt: now,
      id: "org_archived",
      name: "Archived",
      slug: "archived",
      updatedAt: now,
    });

    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const admin = await loginUserSession(
      app,
      "org-admin@example.com",
      PASSWORD,
      orgId
    );
    const member = await loginUserSession(
      app,
      "member@example.com",
      PASSWORD,
      orgId
    );
    const viewer = await loginUserSession(
      app,
      "viewer@example.com",
      PASSWORD,
      orgId
    );
    const outsider = await loginUserSession(
      app,
      "outsider@example.com",
      PASSWORD
    );
    const archived = await loginUserSession(
      app,
      "archived@example.com",
      PASSWORD,
      "org_archived"
    );

    const previewBody = {
      data: Buffer.from(pluginBundle()).toString("base64"),
    };

    expect(
      (
        await jsonRequest(
          app,
          "/v1/platform/plugins/releases/preview",
          platform,
          {
            body: JSON.stringify(previewBody),
            method: "POST",
          }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await jsonRequest(app, "/v1/platform/plugins/releases/preview", admin, {
          body: JSON.stringify(previewBody),
          method: "POST",
        })
      ).status
    ).toBe(403);

    await installRelease(app, platform);

    expect((await jsonRequest(app, "/v1/plugins", admin)).status).toBe(200);
    expect((await jsonRequest(app, "/v1/plugins", member)).status).toBe(200);
    expect((await jsonRequest(app, "/v1/plugins", viewer)).status).toBe(403);
    expect(
      (await jsonRequest(app, "/v1/plugins", outsider, {}, orgId)).status
    ).toBe(404);
    expect(
      (await jsonRequest(app, "/v1/plugins", archived, {}, "org_archived"))
        .status
    ).toBe(404);
    expect(
      (await jsonRequest(app, "/v1/plugins", platform, {}, orgId)).status
    ).toBe(404);

    const add = await jsonRequest(app, "/v1/plugins/notes/install", admin, {
      body: JSON.stringify({}),
      method: "POST",
    });
    expect(add.status).toBe(200);
    const added = (await add.json()) as { revision: number };

    expect(
      (
        await jsonRequest(app, "/v1/plugins/notes/enable", member, {
          body: JSON.stringify({ expectedRevision: added.revision }),
          method: "POST",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await jsonRequest(app, "/v1/plugins/notes/enable", viewer, {
          body: JSON.stringify({ expectedRevision: added.revision }),
          method: "POST",
        })
      ).status
    ).toBe(403);

    await seedUser(databaseAdapter, authService, {
      email: "platform-member@example.com",
      isPlatformAdmin: true,
      orgId,
      role: "member",
      userId: "user_platform_member",
    });
    const platformMember = await loginUserSession(
      app,
      "platform-member@example.com",
      PASSWORD,
      orgId
    );
    const enabled = await jsonRequest(
      app,
      "/v1/plugins/notes/enable",
      platformMember,
      {
        body: JSON.stringify({ expectedRevision: added.revision }),
        method: "POST",
      }
    );
    expect(enabled.status).toBe(200);

    expect(
      (await jsonRequest(app, `/v1/plugins/ui/${orgId}/notes`, viewer)).status
    ).toBe(403);
    expect(
      (
        await jsonRequest(app, "/v1/plugins/notes/actions/list", viewer, {
          body: JSON.stringify({ input: {} }),
          method: "POST",
        })
      ).status
    ).toBe(403);
  });

  test("crafted UI paths cannot leave the enabled UI directory and require auth", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    await installRelease(app, platform, pluginBundle("1.0.1"));
    const added = await pluginService.addOrgPlugin(
      admin.orgId!,
      "notes",
      "1.0.0"
    );
    await pluginService.enableOrgPlugin(admin.orgId!, "notes", added.revision, {
      id: "user_admin",
      role: "admin",
    });

    const orgId = admin.orgId!;
    const document = await jsonRequest(
      app,
      `/v1/plugins/ui/${orgId}/notes`,
      admin
    );
    expect(document.status).toBe(200);
    expect(await document.text()).toContain("notes");

    const asset = await jsonRequest(
      app,
      `/v1/plugins/ui/${orgId}/notes/ui/assets/app.js`,
      admin
    );
    expect(asset.status).toBe(200);

    const forbidden = [
      `/v1/plugins/ui/${orgId}/notes/secret.txt`,
      `/v1/plugins/ui/${orgId}/notes/hooks/activate.js`,
      `/v1/plugins/ui/${orgId}/notes/migrations/001.sql`,
      `/v1/plugins/ui/${orgId}/notes/../1.0.1/ui/index.html`,
      `/v1/plugins/ui/${orgId}/notes/%2e%2e/secret.txt`,
      `/v1/plugins/ui/${orgId}/notes/ui/assets/../../secret.txt`,
    ];
    for (const path of forbidden) {
      expect((await jsonRequest(app, path, admin)).status).toBe(404);
    }

    expect(
      (await jsonRequest(app, `/v1/plugins/ui/${orgId}/notes`, null)).status
    ).toBe(401);
    expect(
      (
        await jsonRequest(
          app,
          `/v1/plugins/ui/${orgId}/notes/ui/assets/app.js`,
          null
        )
      ).status
    ).toBe(401);
  });

  test("plugin documents allow same-origin embedding; other pages keep DENY", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    const added = await pluginService.addOrgPlugin(admin.orgId!, "notes");
    await pluginService.enableOrgPlugin(admin.orgId!, "notes", added.revision, {
      id: "user_admin",
      role: "admin",
    });

    const document = await jsonRequest(
      app,
      `/v1/plugins/ui/${admin.orgId}/notes`,
      admin
    );
    expect(document.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(document.headers.get("Content-Security-Policy") ?? "").toContain(
      "frame-ancestors 'self'"
    );

    const list = await jsonRequest(app, "/v1/plugins", admin);
    expect(list.headers.get("X-Frame-Options")).toBe("DENY");
    expect(list.headers.get("Content-Security-Policy") ?? "").not.toContain(
      "frame-ancestors"
    );

    const login = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(login.headers.get("X-Frame-Options")).toBe("DENY");

    const setup = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", { method: "GET" })
    );
    expect(setup.headers.get("X-Frame-Options")).toBe("DENY");

    const health = await app.fetch(new Request("http://localhost:4310/health"));
    expect(health.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test("iframe path org and action header org do not fall back to another cookie org", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const orgA = admin.orgId!;
    const now = new Date().toISOString();
    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_b",
      name: "Org B",
      slug: "org-b",
      updatedAt: now,
    });
    const adminUser = await databaseAdapter.getUserByEmail("admin@example.com");
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: "org_b",
      role: "admin",
      userId: adminUser!.id,
    });

    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    const added = await pluginService.addOrgPlugin(orgA, "notes");
    await pluginService.enableOrgPlugin(orgA, "notes", added.revision, {
      id: adminUser!.id,
      role: "admin",
    });

    const switched = await jsonRequest(app, "/v1/auth/active-org", admin, {
      body: JSON.stringify({ orgId: "org_b" }),
      method: "POST",
    });
    expect(switched.status).toBe(200);

    const pathOnly = await jsonRequest(
      app,
      `/v1/plugins/ui/${orgA}/notes`,
      admin,
      {},
      ""
    );
    expect(pathOnly.status).toBe(200);

    const conflict = await jsonRequest(
      app,
      `/v1/plugins/ui/${orgA}/notes`,
      admin,
      { headers: { "X-Org-Id": "org_b" } },
      ""
    );
    expect(conflict.status).toBe(400);

    const actionOnA = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/list",
      admin,
      {
        body: JSON.stringify({ input: {} }),
        method: "POST",
      },
      orgA
    );
    expect(actionOnA.status).toBe(200);

    const actionOnCookieB = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/list",
      admin,
      {
        body: JSON.stringify({ input: {} }),
        method: "POST",
      },
      ""
    );
    expect(actionOnCookieB.status).toBe(400);
  });

  test("unknown, disabled, and unauthorized actions fail before execution", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    await seedUser(databaseAdapter, authService, {
      email: "member@example.com",
      orgId: admin.orgId,
      role: "member",
      userId: "user_member",
    });
    const member = await loginUserSession(
      app,
      "member@example.com",
      PASSWORD,
      admin.orgId
    );
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    await pluginService.addOrgPlugin(admin.orgId!, "notes");

    const disabled = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/list",
      member,
      { body: JSON.stringify({ input: {} }), method: "POST" }
    );
    expect(disabled.status).toBe(409);

    const added = await pluginService.getOrgPluginDetail(admin.orgId!, "notes");
    await pluginService.enableOrgPlugin(
      admin.orgId!,
      "notes",
      added!.revision,
      { id: "user_admin", role: "admin" }
    );

    const unknown = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/missing",
      member,
      { body: JSON.stringify({ input: {} }), method: "POST" }
    );
    expect(unknown.status).toBe(404);

    const adminOnly = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/wipe",
      member,
      { body: JSON.stringify({ input: {} }), method: "POST" }
    );
    expect(adminOnly.status).toBe(403);

    const allowed = await jsonRequest(
      app,
      "/v1/plugins/notes/actions/list",
      member,
      { body: JSON.stringify({ input: { q: "n" } }), method: "POST" }
    );
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      result: { input: { q: "n" }, ok: true },
    });
  });

  test("cookie-authenticated mutations require CSRF including package uploads", async () => {
    const { app, authService, databaseAdapter } = createApp();
    await setupFreshInstallSession(app, databaseAdapter);
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const archive = Buffer.from(pluginBundle()).toString("base64");

    const missingCsrf = await app.fetch(
      new Request(
        "http://localhost:4310/v1/platform/plugins/releases/preview",
        {
          body: JSON.stringify({ data: archive }),
          headers: platform.headers({ "Content-Type": "application/json" }),
          method: "POST",
        }
      )
    );
    expect(missingCsrf.status).toBe(403);

    const zipFile = () =>
      new File([Buffer.from(pluginBundle())], "notes.zip", {
        type: "application/zip",
      });
    const missingCsrfUpload = await app.fetch(
      new Request("http://localhost:4310/v1/platform/plugins/releases", {
        body: (() => {
          const form = new FormData();
          form.set("file", zipFile());
          return form;
        })(),
        headers: platform.headers(),
        method: "POST",
      })
    );
    expect(missingCsrfUpload.status).toBe(403);

    const withCsrf = await app.fetch(
      new Request("http://localhost:4310/v1/platform/plugins/releases", {
        body: (() => {
          const form = new FormData();
          form.set("file", zipFile());
          return form;
        })(),
        headers: platform.headers({ "X-CSRF-Token": platform.csrfToken }),
        method: "POST",
      })
    );
    expect(withCsrf.status).toBe(200);
  });

  test("cannot remove a release while an installation or retained schema depends on it", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    const added = await pluginService.addOrgPlugin(admin.orgId!, "notes");

    const blocked = await jsonRequest(
      app,
      "/v1/platform/plugins/releases/notes/1.0.0",
      platform,
      { method: "DELETE" }
    );
    expect(blocked.status).toBe(409);

    await pluginService.uninstallOrgPlugin(
      admin.orgId!,
      "notes",
      added.revision
    );
    const stillBlocked = await jsonRequest(
      app,
      "/v1/platform/plugins/releases/notes/1.0.0",
      platform,
      { method: "DELETE" }
    );
    expect(stillBlocked.status).toBe(409);

    const retained = await pluginService.getOrgPluginDetail(
      admin.orgId!,
      "notes"
    );
    await pluginService.deleteRetainedPluginData(
      admin.orgId!,
      "notes",
      retained!.revision
    );
    const removed = await jsonRequest(
      app,
      "/v1/platform/plugins/releases/notes/1.0.0",
      platform,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(204);
  });

  test("update preview includes lifecycle errors and removed contributions", async () => {
    const { app, authService, databaseAdapter, pluginService } = createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const platform = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await installRelease(app, platform);
    await installRelease(
      app,
      platform,
      pluginBundle("1.1.0", {
        "nakama.plugin.json": JSON.stringify({
          actions: [],
          apiVersion: PLUGIN_MANIFEST_API_VERSION,
          author: "Nakama",
          description: "Notes",
          id: "notes",
          license: "MIT",
          minNakamaVersion: "0.1.0",
          name: "Notes",
          skills: [],
          version: "1.1.0",
        }),
      })
    );
    const added = await pluginService.addOrgPlugin(
      admin.orgId!,
      "notes",
      "1.0.0"
    );
    await pluginService.enableOrgPlugin(admin.orgId!, "notes", added.revision, {
      id: "user_admin",
      role: "admin",
    });
    const enabled = await pluginService.getOrgPluginDetail(
      admin.orgId!,
      "notes"
    );
    await pluginService.disableOrgPlugin(
      admin.orgId!,
      "notes",
      enabled!.revision,
      { id: "user_admin", role: "admin" }
    );

    const preview = await jsonRequest(
      app,
      "/v1/plugins/notes/update/preview?targetVersion=1.1.0",
      admin
    );
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      lastLifecycleError: null,
      removedActionKeys: ["list", "wipe"],
    });
  });

  test("openapi documents plugin routes", async () => {
    const { app } = createApp();
    const response = await app.fetch(
      new Request("http://localhost:4310/openapi.json")
    );
    expect(response.status).toBe(200);
    const spec = (await response.json()) as {
      paths: Record<string, unknown>;
    };
    expect(spec.paths["/v1/platform/plugins/releases"]).toBeTruthy();
    expect(spec.paths["/v1/plugins"]).toBeTruthy();
    expect(
      spec.paths["/v1/plugins/{pluginId}/actions/{actionKey}"]
    ).toBeTruthy();
    expect(spec.paths["/v1/plugins/ui/{orgId}/{pluginId}"]).toBeTruthy();
  });
});
