import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserConfigDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import {
  createNakamaDataExport,
  previewNakamaDataImport,
} from "../../services/data-portability";
import { OrgService } from "../../services/org-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createHonoApp } from "../app";
import { loginPlatformAdminSession } from "../test-session-helpers";

setupTestConfigDir("nakama-setup-import-routes-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const app = createHonoApp({
    agent: {
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      providerConfigured: true,
    } as any,
    authService,
    automationService: {} as any,
    databaseAdapter,
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: { getStatus: async () => ({ ok: true }) } as any,
    taskService: {} as any,
    webDistDir: null,
    workerManager: {} as any,
  });

  return { app, authService, databaseAdapter };
}

describe("setup import routes", () => {
  test("fresh install can preview and restore import without authentication", async () => {
    const { app } = createApp();
    await writeFile(join(getUserConfigDir(), "config.ini"), "original");
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({ data: archive.toString("base64") }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      archiveFileCount: 1,
      willReplaceRoot: true,
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("changed");

    const restoreResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/restore", {
        body: JSON.stringify({
          confirm: true,
          data: archive.toString("base64"),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      // createApp() omits onDataRestored — client must restart.
      requiresRestart: true,
      restoredFileCount: 1,
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("original");
  });

  test("setup restore reports requiresRestart false after onDataRestored succeeds", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    let restoredCalls = 0;
    const app = createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
        providerConfigured: true,
      } as any,
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      onDataRestored: async () => {
        restoredCalls += 1;
      },
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      taskService: {} as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    await writeFile(join(getUserConfigDir(), "config.ini"), "original");
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;
    await writeFile(join(getUserConfigDir(), "config.ini"), "changed");

    const restoreResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/restore", {
        body: JSON.stringify({
          confirm: true,
          data: archive.toString("base64"),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(restoreResponse.status).toBe(200);
    expect(restoredCalls).toBe(1);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      requiresRestart: false,
      restoredFileCount: 1,
    });
  });

  test("setup restore keeps 200 with requiresRestart when onDataRestored throws", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
        providerConfigured: true,
      } as any,
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      onDataRestored: async () => {
        throw new Error("reopen failed");
      },
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      taskService: {} as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    await writeFile(join(getUserConfigDir(), "config.ini"), "original");
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;

    const restoreResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/restore", {
        body: JSON.stringify({
          confirm: true,
          data: archive.toString("base64"),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      requiresRestart: true,
    });
    await expect(
      readFile(join(getUserConfigDir(), "config.ini"), "utf8")
    ).resolves.toBe("original");
  });

  test("setup import is blocked after the first admin account exists", async () => {
    const { app, authService, databaseAdapter } = createApp();
    await loginPlatformAdminSession(app, authService, databaseAdapter);
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;

    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({ data: archive.toString("base64") }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(previewResponse.status).toBe(409);
    await expect(previewResponse.json()).resolves.toEqual({
      error:
        "Setup import is only available before the first admin account is created.",
    });
  });

  test("invalid setup import archive is rejected", async () => {
    const { app } = createApp();
    await writeFile(join(getUserConfigDir(), "config.ini"), "keep");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({
          data: Buffer.from("not a zip").toString("base64"),
        }),
        headers: { "Content-Type": "application/json" },
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

  test("setup import preview accepts valid archives", async () => {
    const { app } = createApp();
    await writeFile(join(getUserConfigDir(), "config.ini"), "provider=openai");
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;
    const preview = await previewNakamaDataImport(archive, {
      rootDir: getUserConfigDir(),
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({ data: archive.toString("base64") }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      archiveFileCount: preview.archiveFileCount,
      topLevelPaths: preview.topLevelPaths,
    });
  });
});
