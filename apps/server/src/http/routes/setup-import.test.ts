import { describe, expect, spyOn, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserConfigDir } from "@nakama/core";
import { unzipSync, zipSync } from "fflate";
import * as dataPortability from "../../services/data-portability";
import {
  createNakamaDataExport,
  MAX_IMPORT_ENTRIES,
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

async function createArchiveOverEntryLimit(): Promise<Buffer> {
  const archive = (
    await createNakamaDataExport({ rootDir: getUserConfigDir() })
  ).data;
  const entries = unzipSync(archive);
  for (let index = 0; index < MAX_IMPORT_ENTRIES; index += 1) {
    entries[`empty-${index}.txt`] = new Uint8Array();
  }
  return Buffer.from(zipSync(entries, { level: 0 }));
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

  test("setup preview and restore reject archives over the entry limit", async () => {
    const { app } = createApp();
    const configPath = join(getUserConfigDir(), "config.ini");
    await writeFile(configPath, "keep");
    const archive = await createArchiveOverEntryLimit();
    const data = archive.toString("base64");

    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({ data }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    const restoreResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/restore", {
        body: JSON.stringify({ confirm: true, data }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(restoreResponse.status).toBe(400);
    await expect(readFile(configPath, "utf8")).resolves.toBe("keep");
  });

  test("wrong-typed setup import body is rejected before decoding", async () => {
    const { app } = createApp();

    const previewResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/preview", {
        body: JSON.stringify({ data: 42 }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(previewResponse.status).toBe(400);

    const restoreResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup/import/restore", {
        body: JSON.stringify({ confirm: "yes", data: "archive" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(restoreResponse.status).toBe(400);
  });

  test("setup import preview does not leak an unexpected error's message", async () => {
    const { app } = createApp();
    await writeFile(join(getUserConfigDir(), "config.ini"), "keep");
    const archive = (
      await createNakamaDataExport({ rootDir: getUserConfigDir() })
    ).data;

    const previewSpy = spyOn(
      dataPortability,
      "previewNakamaDataImport"
    ).mockImplementation(async () => {
      throw new Error(
        "ENOENT: no such file or directory, open '/home/nakama/.config/nakama/nakama.db'"
      );
    });

    try {
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/auth/setup/import/preview", {
          body: JSON.stringify({ data: archive.toString("base64") }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "An unexpected server error occurred.",
      });
    } finally {
      previewSpy.mockRestore();
    }
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
