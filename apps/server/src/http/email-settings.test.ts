import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { AgentService } from "../services/agent-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupFreshInstallSession } from "./test-session-helpers";

describe("email settings routes", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("org admin can read and update email settings without exposing password", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-email-route-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
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

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const getEmpty = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      }),
    );
    expect(getEmpty.status).toBe(200);
    const emptyBody = (await getEmpty.json()) as Record<string, unknown>;
    expect(emptyBody.configured).toBe(false);
    expect("password" in emptyBody).toBe(false);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        method: "PUT",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          imapHost: "imap.example.com",
          smtpHost: "smtp.example.com",
          username: "admin@example.com",
          password: "secret-pass",
          from: "admin@example.com",
        }),
      }),
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as { configured: boolean; passwordMasked: string | null };
    expect(saved.configured).toBe(true);
    expect(saved.passwordMasked).not.toBe("secret-pass");

    const putWithoutPassword = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        method: "PUT",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          smtpHost: "smtp2.example.com",
        }),
      }),
    );
    expect(putWithoutPassword.status).toBe(200);

    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      }),
    );
    const savedBody = (await getSaved.json()) as { smtpHost: string | null; passwordMasked: string | null };
    expect(savedBody.smtpHost).toBe("smtp2.example.com");
    expect(savedBody.passwordMasked).toBeTruthy();
  });
});
