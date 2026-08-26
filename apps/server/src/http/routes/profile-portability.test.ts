import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCustomToolsDir } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { unzipSync } from "fflate";
import type { AuthService } from "../../services/auth-service";
import { PROFILE_PACK_KIND } from "../../services/profile-portability";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profile-pack-routes-");

const BASE = "http://localhost:4310";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        createProfile: (orgId: string, request: unknown) =>
          profileService.createProfile(
            orgId,
            request as { name: string; isSuper?: boolean }
          ),
        listProfiles: async (orgId: string) => ({
          profiles: await databaseAdapter.listProfilesForOrg(orgId),
        }),
      },
      databaseAdapter,
    }),
    databaseAdapter,
    profileService,
  };
}

async function createOrgAdminSession(
  app: ReturnType<typeof createApp>["app"],
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  slug: string,
  email: string
) {
  const platformSession = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );
  const createResponse = await app.fetch(
    new Request(`${BASE}/v1/platform/orgs`, {
      body: JSON.stringify({
        admin: { email, name: "Pack Admin", phone: "+628123456789" },
        name: "Pack Org",
        slug,
      }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(createResponse.status).toBe(201);
  const created = (await createResponse.json()) as {
    organization: { id: string };
    adminMember: { temporaryPassword: string };
  };
  return {
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id
    ),
    orgId: created.organization.id,
    platformSession,
  };
}

function jsonHeaders(
  session: {
    headers: (extra?: Record<string, string>, orgId?: string) => Headers;
    csrfToken: string;
  },
  orgId: string
) {
  return session.headers(
    {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    },
    orgId
  );
}

describe("profile pack routes", () => {
  test("org admin can export, preview, and import", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-export",
      "pack-admin@example.com"
    );
    const created = await profileService.createProfile(orgId, {
      name: "Packable Bot",
      systemPrompt: "help",
    });
    await databaseAdapter.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Private custom tool",
      handlerConfig: { modulePath: "private.js" },
      handlerType: "javascript",
      id: "tool_private",
      name: "private_tool",
      updatedAt: new Date().toISOString(),
    });
    await databaseAdapter.assignToolToProfile(
      created.profile.id,
      "tool_private"
    );

    const exportResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
        headers: adminSession.headers({}, orgId),
      })
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toBe("application/zip");
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    const archiveEntries = unzipSync(new Uint8Array(archive));
    const manifest = JSON.parse(
      Buffer.from(archiveEntries["nakama-profile-export.json"] ?? []).toString(
        "utf8"
      )
    ) as { meta: { customTools?: unknown[] } };
    expect(manifest.meta.customTools).toBeUndefined();
    const data = archive.toString("base64");

    const previewResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import/preview`, {
        body: JSON.stringify({ data }),
        headers: jsonHeaders(adminSession, orgId),
        method: "POST",
      })
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      manifest: { kind: string };
      plannedName: string;
    };
    expect(preview.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(preview.plannedName).toBe("Packable Bot");

    const before = (await databaseAdapter.listProfilesForOrg(orgId)).length;
    const importResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import`, {
        body: JSON.stringify({
          confirm: true,
          data,
          name: "Packable Bot (imported)",
        }),
        headers: jsonHeaders(adminSession, orgId),
        method: "POST",
      })
    );
    expect(importResponse.status).toBe(200);
    expect(await databaseAdapter.listProfilesForOrg(orgId)).toHaveLength(
      before + 1
    );
  }, 30_000);

  test("member is forbidden; platform admin who is an org member can export", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();
    const { orgId, platformSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-auth",
      "pack-owner@example.com"
    );
    const created = await profileService.createProfile(orgId, {
      name: "Auth Bot",
    });

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "pack-member@example.com",
      id: "user_pack_member",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_pack_member",
    });
    const member = await loginUserSession(
      app,
      "pack-member@example.com",
      "password123",
      orgId
    );

    expect(
      (
        await app.fetch(
          new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
            headers: member.headers({}, orgId),
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request(`${BASE}/v1/profiles/pack/import/preview`, {
            body: JSON.stringify({ data: "YQ==" }),
            headers: jsonHeaders(member, orgId),
            method: "POST",
          })
        )
      ).status
    ).toBe(403);

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: platformUser!.id,
    });
    const toolsDir = getCustomToolsDir();
    await mkdir(toolsDir, { recursive: true });
    await writeFile(
      path.join(toolsDir, "platform-portable.js"),
      "export async function run() {}\n",
      "utf8"
    );
    await databaseAdapter.upsertTool({
      createdAt: now,
      description: "Platform portable tool",
      handlerConfig: { modulePath: "platform-portable.js" },
      handlerType: "javascript",
      id: "tool_platform_portable",
      name: "platform_portable",
      updatedAt: now,
    });
    await databaseAdapter.assignToolToProfile(
      created.profile.id,
      "tool_platform_portable"
    );
    const platformExport = await app.fetch(
      new Request(`${BASE}/v1/profiles/${created.profile.id}/pack/export`, {
        headers: platformSession.headers({}, orgId),
      })
    );
    expect(platformExport.status).toBe(200);
    const platformArchive = unzipSync(
      new Uint8Array(await platformExport.arrayBuffer())
    );
    expect(platformArchive["custom-tools/platform-portable.js"]).toBeDefined();
  }, 30_000);
});
