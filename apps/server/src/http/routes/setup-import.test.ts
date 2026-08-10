import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserConfigDir } from "@nakama/core";
import {
  createNakamaDataExport,
  previewNakamaDataImport,
} from "../../services/data-portability";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginPlatformAdminSession } from "../test-session-helpers";

setupTestConfigDir("nakama-setup-import-routes-test-");

function createApp() {
  return createMinimalHonoApp({
    agent: {
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      providerConfigured: true,
    },
  });
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
    let restoredCalls = 0;
    const { app } = createMinimalHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
        providerConfigured: true,
      },
      onDataRestored: async () => {
        restoredCalls += 1;
      },
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
    const { app } = createMinimalHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
        providerConfigured: true,
      },
      onDataRestored: async () => {
        throw new Error("reopen failed");
      },
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
