import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCustomToolsDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  MAX_IMPORT_ENTRY_BYTES,
  MAX_IMPORT_UNCOMPRESSED_BYTES,
} from "../../services/data-portability";
import { MAX_PROFILE_PACK_ENTRY_COUNT } from "../../services/profile-portability";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
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
    const data = Buffer.from(await exportResponse.arrayBuffer()).toString(
      "base64"
    );

    const previewResponse = await app.fetch(
      new Request(`${BASE}/v1/profiles/pack/import/preview`, {
        body: JSON.stringify({ data }),
        headers: jsonHeaders(adminSession, orgId),
        method: "POST",
      })
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      plannedName: string;
    };
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

  test.each([
    ["preview", "/v1/profiles/pack/import/preview"],
    ["import", "/v1/profiles/pack/import"],
  ])("rejects expansion bombs during %s", async (_operation, path) => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "pack-limits",
      "pack-limits@example.com"
    );
    const totalEntryCount =
      Math.ceil(MAX_IMPORT_UNCOMPRESSED_BYTES / MAX_IMPORT_ENTRY_BYTES) + 1;
    const cases = [
      {
        archive: buildZipWithEntries([
          {
            content: "x",
            declaredSize: MAX_IMPORT_ENTRY_BYTES + 1,
            name: "MEMORY.md",
          },
        ]),
        expected: /entry MEMORY\.md exceeds/,
        limit: "per-entry",
      },
      {
        archive: buildZipWithEntries(
          Array.from({ length: totalEntryCount }, (_, index) => ({
            content: "x",
            declaredSize: MAX_IMPORT_ENTRY_BYTES,
            name: `part-${index}.md`,
          }))
        ),
        expected: /uncompressed limit/,
        limit: "total",
      },
      {
        archive: buildZipWithEntries(
          Array.from({ length: MAX_PROFILE_PACK_ENTRY_COUNT + 1 }, (_, i) => ({
            content: "x",
            name: `part-${i}.md`,
          }))
        ),
        expected: /entry limit/,
        limit: "entry-count",
      },
    ];

    for (const { archive, expected, limit } of cases) {
      const response = await app.fetch(
        new Request(`${BASE}${path}`, {
          body: JSON.stringify({
            confirm: true,
            data: archive.toString("base64"),
          }),
          headers: jsonHeaders(adminSession, orgId),
          method: "POST",
        })
      );
      const body = (await response.json()) as { error: string };

      expect({ limit, status: response.status }).toEqual({
        limit,
        status: 413,
      });
      expect(body.error).toMatch(expected);
    }
  });

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
    expect(platformExport.headers.get("content-type")).toBe("application/zip");
  }, 30_000);
});

/** Build ZIP metadata that declares sizes without allocating expanded data. */
function buildZipWithEntries(
  entries: Array<{ content: string; declaredSize?: number; name: string }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const content = Buffer.from(entry.content, "utf8");
    const declaredSize = entry.declaredSize ?? content.length;
    const name = Buffer.from(entry.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04_03_4b_50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x08_00, 6);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(declaredSize, 22);
    localHeader.writeUInt16LE(name.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02_01_4b_50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x08_00, 8);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(declaredSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, name, content);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
