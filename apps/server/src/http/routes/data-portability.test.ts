import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserConfigDir } from "@tinyclaw/core";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { previewTinyClawDataImport } from "../../services/data-portability";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { browserSessionFromResponse, loginPlatformAdminSession } from "../test-session-helpers";

setupTestConfigDir("tinyclaw-data-portability-routes-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const app = createHonoApp({
    agent: {
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      providerConfigured: true,
    } as any,
    automationService: {} as any,
    taskService: {} as any,
    systemStatus: { getStatus: async () => ({ ok: true }) } as any,
    workerManager: {} as any,
    mcpService: {} as any,
    authService,
    orgService: new OrgService(databaseAdapter, authService),
    databaseAdapter,
    webDistDir: null,
  });

  return { app, authService, databaseAdapter };
}

describe("data portability routes", () => {
  test("platform admin can download a Tinyclaw export ZIP", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    await writeFile(join(getUserConfigDir(), "config.ini"), "provider=openai");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("tinyclaw-export-");

    const preview = await previewTinyClawDataImport(Buffer.from(await response.arrayBuffer()));
    expect(preview.manifest.kind).toBe("tinyclaw-export");
    expect(preview.topLevelPaths).toContain("config.ini");
  });

  test("platform admin can preview import without mutating local data", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    await writeFile(join(getUserConfigDir(), "config.ini"), "original");

    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      }),
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        method: "POST",
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        body: JSON.stringify({ data: archive.toString("base64") }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      archiveFileCount: 1,
      willReplaceRoot: true,
    });
    await expect(readFile(join(getUserConfigDir(), "config.ini"), "utf8")).resolves.toBe(
      "changed",
    );
  });

  test("platform admin can restore import only with confirmation", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    await writeFile(join(getUserConfigDir(), "config.ini"), "original");
    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: session.headers(),
      }),
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const rejected = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/restore", {
        method: "POST",
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        body: JSON.stringify({ confirm: false, data: archive.toString("base64") }),
      }),
    );
    expect(rejected.status).toBe(400);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/restore", {
        method: "POST",
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        body: JSON.stringify({ confirm: true, data: archive.toString("base64") }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ restoredFileCount: 1 });
    await expect(readFile(join(getUserConfigDir(), "config.ini"), "utf8")).resolves.toBe(
      "original",
    );
  });

  test("platform admin can run data folder migration", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    const profileDir = join(getUserConfigDir(), "orgs", "org_test", "profiles", "profile_one");
    await mkdir(join(profileDir, "data", "knowledge-base", "uploads", "kb_doc"), { recursive: true });
    await mkdir(join(profileDir, "data", "knowledge-base", "extracted"), { recursive: true });
    await writeFile(
      join(profileDir, "data", "knowledge-base", "manifest.json"),
      JSON.stringify({
        documents: [
          {
            id: "kb_doc",
            filename: "notes.txt",
            mediaType: "text/plain",
            sizeBytes: 11,
            uploadedAt: "2026-07-01T00:00:00.000Z",
            status: "ready",
          },
        ],
      }),
    );
    await writeFile(
      join(profileDir, "data", "knowledge-base", "uploads", "kb_doc", "notes.txt"),
      "hello world",
    );
    await writeFile(
      join(profileDir, "data", "knowledge-base", "extracted", "kb_doc.txt"),
      "# source: notes.txt\n\nhello world",
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/migrate-folders", {
        method: "POST",
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profilesScanned: 1,
      profilesChanged: 1,
    });
    await expect(
      readFile(join(profileDir, "knowledge-base", "kb_doc--notes.txt"), "utf8"),
    ).resolves.toBe("hello world");
  });

  test("non-platform users cannot export or import data", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);
    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        body: JSON.stringify({
          name: "Acme",
          slug: "acme",
          admin: { name: "Acme Admin", email: "admin@acme.test", phone: "+628123456789" },
        }),
      }),
    );
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };
    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@acme.test",
          password: created.adminMember.temporaryPassword,
        }),
      }),
    );
    const orgSession = browserSessionFromResponse(loginResponse, created.organization.id);

    const exportResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/export", {
        headers: orgSession.headers(),
      }),
    );
    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        method: "POST",
        headers: orgSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": orgSession.csrfToken,
        }),
        body: JSON.stringify({ data: Buffer.from("bad").toString("base64") }),
      }),
    );

    expect(exportResponse.status).toBe(403);
    expect(previewResponse.status).toBe(403);
  });

  test("invalid import archive is rejected and preserves current files", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    await mkdir(getUserConfigDir(), { recursive: true });
    await writeFile(join(getUserConfigDir(), "config.ini"), "keep");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/data/import/preview", {
        method: "POST",
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        body: JSON.stringify({ data: Buffer.from("not a zip").toString("base64") }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid ZIP archive." });
    await expect(readFile(join(getUserConfigDir(), "config.ini"), "utf8")).resolves.toBe("keep");
  });
});
