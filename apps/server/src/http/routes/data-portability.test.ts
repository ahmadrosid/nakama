import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserConfigDir } from "@nakama/core";
import { previewNakamaDataImport } from "../../services/data-portability";
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

    const preview = await previewNakamaDataImport(
      Buffer.from(await response.arrayBuffer())
    );
    expect(preview.manifest.kind).toBe("nakama-export");
    expect(preview.topLevelPaths).toContain("config.ini");
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
