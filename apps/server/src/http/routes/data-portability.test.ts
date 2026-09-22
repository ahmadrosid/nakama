import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getKnowledgeBaseDir,
  getOrgKnowledgeBaseDir,
  getProfileArtifactsDir,
  getUserConfigDir,
  saveAttachmentBytes,
} from "@nakama/core";
import { unzipSync } from "fflate";
import {
  NAKAMA_ORG_EXPORT_MANIFEST,
  NAKAMA_USER_EXPORT_MANIFEST,
} from "../../services/data-portability";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-data-portability-routes-test-");

function createApp() {
  return createMinimalHonoApp({
    agent: {
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      providerConfigured: true,
    },
  });
}

describe("data portability routes", () => {
  test("platform admin can download a Nakama export ZIP", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await writeFile(join(getUserConfigDir(), "config.ini"), "provider=openai");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(
      "nakama-export-"
    );
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("platform admin exports one user's data without secrets or other users", async () => {
    const { app, authService, databaseAdapter, orgService } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const targetOrg = await orgService.createOrganization({
      name: "Target Org",
      slug: "target-org",
    });
    const otherOrg = await orgService.createOrganization({
      name: "Other Org",
      slug: "other-org",
    });
    const [targetProfile] = await databaseAdapter.listProfilesForOrg(
      targetOrg.organization.id
    );
    const [otherProfile] = await databaseAdapter.listProfilesForOrg(
      otherOrg.organization.id
    );
    expect(targetProfile).toBeDefined();
    expect(otherProfile).toBeDefined();

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "target@example.com",
      id: "user_dsar_target",
      name: "Target User",
      passwordHash: await authService.hashPassword("target-password"),
      phone: "+628111111111",
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: targetOrg.organization.id,
      role: "member",
      userContext: "prefers concise replies",
      userId: "user_dsar_target",
    });
    await databaseAdapter.createUser({
      createdAt: now,
      email: "other@example.com",
      id: "user_dsar_other",
      passwordHash: await authService.hashPassword("other-password"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: otherOrg.organization.id,
      role: "member",
      userId: "user_dsar_other",
    });
    await databaseAdapter.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_dsar_target",
      model: null,
      orgId: targetOrg.organization.id,
      profileId: targetProfile!.id,
      title: "Target chat",
      userId: "user_dsar_target",
    });
    await databaseAdapter.appendMessagesForSession("session_dsar_target", [
      {
        createdAt: now,
        id: "message_dsar_target",
        payload: { content: "portable message", role: "user" },
        seq: 0,
        sessionId: "session_dsar_target",
      },
    ]);
    const attachmentPath = await saveAttachmentBytes(
      targetOrg.organization.id,
      targetProfile!.id,
      "attachment_dsar_target",
      Buffer.from("portable attachment")
    );
    await databaseAdapter.insertAttachment({
      channel: "web",
      createdAt: now,
      ephemeral: false,
      filename: "note.txt",
      id: "attachment_dsar_target",
      kind: "document",
      mediaType: "text/plain",
      orgId: targetOrg.organization.id,
      profileId: targetProfile!.id,
      sessionId: "session_dsar_target",
      sizeBytes: 19,
      storagePath: attachmentPath,
    });
    await databaseAdapter.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_dsar_other",
      model: null,
      orgId: otherOrg.organization.id,
      profileId: otherProfile!.id,
      title: "Other chat",
      userId: "user_dsar_other",
    });
    await databaseAdapter.appendMessagesForSession("session_dsar_other", [
      {
        createdAt: now,
        id: "message_dsar_other",
        payload: { content: "other-tenant-secret", role: "user" },
        seq: 0,
        sessionId: "session_dsar_other",
      },
    ]);
    await writeFile(
      join(getUserConfigDir(), "config.ini"),
      "api_key=provider-secret"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/platform/users/user_dsar_target/data/export",
        { headers: session.headers() }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(
      "nakama-user-export-"
    );
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual([
      "attachments/attachment_dsar_target",
      NAKAMA_USER_EXPORT_MANIFEST,
    ]);
    const manifest = JSON.parse(
      Buffer.from(archive[NAKAMA_USER_EXPORT_MANIFEST]!).toString("utf8")
    ) as {
      memberships: unknown[];
      sessions: Array<{
        attachments: Array<{ path: string }>;
        messages: Array<{ payload: { content: string } }>;
      }>;
      user: { email: string; id: string };
    };
    expect(manifest.user).toMatchObject({
      email: "target@example.com",
      id: "user_dsar_target",
    });
    expect(manifest.memberships).toHaveLength(1);
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0]!.messages[0]!.payload.content).toBe(
      "portable message"
    );
    expect(manifest.sessions[0]!.attachments[0]!.path).toBe(
      "attachments/attachment_dsar_target"
    );
    const exportedText = Object.values(archive)
      .map((entry) => Buffer.from(entry).toString("utf8"))
      .join("\n");
    expect(exportedText).not.toContain("passwordHash");
    expect(exportedText).not.toContain("provider-secret");
    expect(exportedText).not.toContain("other-tenant-secret");

    const missingResponse = await app.fetch(
      new Request(
        "http://localhost:4310/v1/platform/users/user_missing/data/export",
        { headers: session.headers() }
      )
    );
    expect(missingResponse.status).toBe(404);
  });

  test("platform admin exports one organization's data without secrets or other tenants", async () => {
    const { app, authService, databaseAdapter, orgService } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const targetOrg = await orgService.createOrganization({
      name: "Target Export Org",
      slug: "target-export-org",
    });
    const otherOrg = await orgService.createOrganization({
      name: "Other Export Org",
      slug: "other-export-org",
    });
    const [targetProfile] = await databaseAdapter.listProfilesForOrg(
      targetOrg.organization.id
    );
    const [otherProfile] = await databaseAdapter.listProfilesForOrg(
      otherOrg.organization.id
    );
    expect(targetProfile).toBeDefined();
    expect(otherProfile).toBeDefined();

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "org-export-member@example.com",
      id: "user_org_export",
      name: "Org Export Member",
      passwordHash: await authService.hashPassword("target-password"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: targetOrg.organization.id,
      role: "member",
      userId: "user_org_export",
    });
    await databaseAdapter.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_org_export",
      model: null,
      orgId: targetOrg.organization.id,
      profileId: targetProfile!.id,
      title: "Portable org chat",
      userId: "user_org_export",
    });
    await databaseAdapter.appendMessagesForSession("session_org_export", [
      {
        createdAt: now,
        id: "message_org_export",
        payload: { content: "portable org message", role: "user" },
        seq: 0,
        sessionId: "session_org_export",
      },
    ]);
    const attachmentPath = await saveAttachmentBytes(
      targetOrg.organization.id,
      targetProfile!.id,
      "attachment_org_export",
      Buffer.from("portable org attachment")
    );
    await databaseAdapter.insertAttachment({
      channel: "web",
      createdAt: now,
      ephemeral: false,
      filename: "org-note.txt",
      id: "attachment_org_export",
      kind: "document",
      mediaType: "text/plain",
      orgId: targetOrg.organization.id,
      profileId: targetProfile!.id,
      sessionId: "session_org_export",
      sizeBytes: 23,
      storagePath: attachmentPath,
    });
    await databaseAdapter.upsertAutomation({
      createdAt: now,
      definition: { prompt: "portable org automation" },
      enabled: true,
      id: "automation_org_export",
      name: "Portable automation",
      orgId: targetOrg.organization.id,
      profileId: targetProfile!.id,
      updatedAt: now,
      version: 1,
    });
    await databaseAdapter.insertAutomationRun({
      automationId: "automation_org_export",
      completedAt: now,
      error: null,
      id: "automation_run_org_export",
      output: "portable automation result",
      startedAt: now,
      status: "completed",
    });

    const artifactDir = getProfileArtifactsDir(
      targetOrg.organization.id,
      targetProfile!.id
    );
    const profileKnowledgeBaseDir = getKnowledgeBaseDir(
      targetOrg.organization.id,
      targetProfile!.id
    );
    const orgKnowledgeBaseDir = getOrgKnowledgeBaseDir(
      targetOrg.organization.id
    );
    await mkdir(artifactDir, { recursive: true });
    await mkdir(profileKnowledgeBaseDir, { recursive: true });
    await mkdir(orgKnowledgeBaseDir, { recursive: true });
    await writeFile(join(artifactDir, "report.txt"), "portable artifact");
    await writeFile(
      join(profileKnowledgeBaseDir, "profile-note.md"),
      "portable profile knowledge"
    );
    await writeFile(
      join(orgKnowledgeBaseDir, "org-note.md"),
      "portable organization knowledge"
    );

    await databaseAdapter.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_other_org_export",
      model: null,
      orgId: otherOrg.organization.id,
      profileId: otherProfile!.id,
      title: "Other tenant chat",
    });
    await databaseAdapter.appendMessagesForSession("session_other_org_export", [
      {
        createdAt: now,
        id: "message_other_org_export",
        payload: { content: "other-tenant-secret", role: "user" },
        seq: 0,
        sessionId: "session_other_org_export",
      },
    ]);
    await writeFile(
      join(getUserConfigDir(), "config.ini"),
      "api_key=provider-secret"
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${targetOrg.organization.id}/data/export`,
        { headers: session.headers() }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(
      "nakama-org-export-target-export-org-"
    );
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(archive)).toContain(NAKAMA_ORG_EXPORT_MANIFEST);
    expect(Object.keys(archive)).toContain(
      `profiles/${targetProfile!.id}/artifacts/report.txt`
    );
    expect(Object.keys(archive)).toContain(
      `profiles/${targetProfile!.id}/knowledge-base/profile-note.md`
    );
    expect(Object.keys(archive)).toContain(
      "organization/knowledge-base/org-note.md"
    );
    expect(Object.keys(archive)).toContain("attachments/attachment_org_export");

    const manifest = JSON.parse(
      Buffer.from(archive[NAKAMA_ORG_EXPORT_MANIFEST]!).toString("utf8")
    ) as {
      automations: Array<{ id: string; runs: Array<{ id: string }> }>;
      members: Array<{ user: { email?: string; id: string } }>;
      organization: { id: string };
      profiles: Array<{ id: string }>;
      sessions: Array<{
        id: string;
        messages: Array<{ payload: { content: string } }>;
      }>;
    };
    expect(manifest.organization.id).toBe(targetOrg.organization.id);
    expect(manifest.members).toContainEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: "org-export-member@example.com",
          id: "user_org_export",
        }),
      })
    );
    expect(manifest.profiles.map((profile) => profile.id)).toContain(
      targetProfile!.id
    );
    expect(manifest.automations).toContainEqual(
      expect.objectContaining({
        id: "automation_org_export",
        runs: [expect.objectContaining({ id: "automation_run_org_export" })],
      })
    );
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0]!.messages[0]!.payload.content).toBe(
      "portable org message"
    );

    const exportedText = Object.values(archive)
      .map((entry) => Buffer.from(entry).toString("utf8"))
      .join("\n");
    expect(exportedText).not.toContain("passwordHash");
    expect(exportedText).not.toContain("provider-secret");
    expect(exportedText).not.toContain("other-tenant-secret");

    const missingResponse = await app.fetch(
      new Request(
        "http://localhost:4310/v1/platform/orgs/org_missing/data/export",
        { headers: session.headers() }
      )
    );
    expect(missingResponse.status).toBe(404);
  });

  test("platform admin can preview import without mutating local data", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await writeFile(join(getUserConfigDir(), "config.ini"), "original");

    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      })
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        body: JSON.stringify({ data: archive.toString("base64") }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      archiveFileCount: 1,
      willReplaceRoot: true,
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("changed");
  });

  test("platform admin can restore import only with confirmation", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await writeFile(join(getUserConfigDir(), "config.ini"), "original");
    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      })
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const rejected = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/restore", {
        body: JSON.stringify({
          confirm: false,
          data: archive.toString("base64"),
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(rejected.status).toBe(400);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/restore", {
        body: JSON.stringify({
          confirm: true,
          data: archive.toString("base64"),
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      restoredFileCount: 1,
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("original");
  });

  test("non-platform users cannot export or import data", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin@acme.test",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };
    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@acme.test",
          password: created.adminMember.temporaryPassword,
        }),
        method: "POST",
      })
    );
    const orgSession = browserSessionFromResponse(
      loginResponse,
      created.organization.id
    );

    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: orgSession.headers(),
      })
    );
    const userExportResponse = await app.fetch(
      new Request(
        "http://localhost:4310/v1/platform/users/user_missing/data/export",
        { headers: orgSession.headers() }
      )
    );
    const orgExportResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}/data/export`,
        { headers: orgSession.headers() }
      )
    );
    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        body: JSON.stringify({ data: Buffer.from("bad").toString("base64") }),
        headers: orgSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": orgSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(exportResponse.status).toBe(403);
    expect(userExportResponse.status).toBe(403);
    expect(orgExportResponse.status).toBe(403);
    expect(previewResponse.status).toBe(403);
  });

  test("invalid import archive is rejected and preserves current files", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    await mkdir(getUserConfigDir(), { recursive: true });
    await writeFile(join(getUserConfigDir(), "config.ini"), "keep");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        body: JSON.stringify({
          data: Buffer.from("not a zip").toString("base64"),
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid ZIP archive.",
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("keep");
  });
});
