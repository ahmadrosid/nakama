import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupFreshInstallSession } from "./test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";

setupTestConfigDir("nakama-web-public-url-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    databaseAdapter,
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
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
    }),
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
        }),
      );
      expect(getResponse.status).toBe(200);
      const initial = (await getResponse.json()) as { webPublicUrl: string | null };
      expect(initial.webPublicUrl).toBeNull();

      const putResponse = await app.fetch(
        new Request("http://localhost:4310/v1/system/web-public-url", {
          method: "PUT",
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            session.orgId,
          ),
          body: JSON.stringify({ webPublicUrl: "https://app.example.com/setup" }),
        }),
      );
      expect(putResponse.status).toBe(200);
      const saved = (await putResponse.json()) as { webPublicUrl: string };
      expect(saved.webPublicUrl).toBe("https://app.example.com");

      const getAfterSave = await app.fetch(
        new Request("http://localhost:4310/v1/system/web-public-url", {
          headers: session.headers({}, session.orgId),
        }),
      );
      const afterSave = (await getAfterSave.json()) as { webPublicUrl: string | null };
      expect(afterSave.webPublicUrl).toBe("https://app.example.com");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
