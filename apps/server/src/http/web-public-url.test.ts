import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-web-public-url-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
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
    }),
    databaseAdapter,
  };
}

describe("web public url settings", () => {
  test("org admin can read and persist the public web URL", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-web-public-url-"));
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const { app, databaseAdapter } = createApp();
      const session = await setupFreshInstallSession(app, databaseAdapter);

      const getResponse = await app.fetch(
        new Request("http://localhost:4310/v1/system/web-public-url", {
          headers: session.headers({}, session.orgId),
        })
      );
      expect(getResponse.status).toBe(200);
      const initial = (await getResponse.json()) as {
        webPublicUrl: string | null;
      };
      expect(initial.webPublicUrl).toBeNull();

      const putResponse = await app.fetch(
        new Request("http://localhost:4310/v1/system/web-public-url", {
          body: JSON.stringify({
            webPublicUrl: "https://app.example.com/setup",
          }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            session.orgId
          ),
          method: "PUT",
        })
      );
      expect(putResponse.status).toBe(200);
      const saved = (await putResponse.json()) as { webPublicUrl: string };
      expect(saved.webPublicUrl).toBe("https://app.example.com/setup");

      const getAfterSave = await app.fetch(
        new Request("http://localhost:4310/v1/system/web-public-url", {
          headers: session.headers({}, session.orgId),
        })
      );
      const afterSave = (await getAfterSave.json()) as {
        webPublicUrl: string | null;
      };
      expect(afterSave.webPublicUrl).toBe("https://app.example.com/setup");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { force: true, recursive: true });
    }
  });
});
