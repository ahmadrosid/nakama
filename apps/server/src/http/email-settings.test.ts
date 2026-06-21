import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { AgentService } from "../services/agent-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { buildSetupAuthBody, withOrgId } from "./test-org-helpers";

function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  const session = setCookies.find((entry) => entry.startsWith("tinyclaw_session="));
  const csrf = setCookies.find((entry) => entry.startsWith("tinyclaw_csrf="));
  return [session, csrf].filter(Boolean).map((entry) => entry!.split(";")[0]).join("; ");
}

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing cookie: ${name}`);
  }

  return cookie.split(";")[0]!.split("=", 2)[1]!;
}

describe("email settings routes", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.TINYCLAW_CONFIG_DIR;
  });

  test("org admin can read and update email settings without exposing password", async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-email-route-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

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

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );
    expect(setupResponse.status).toBe(201);
    const setupBody = (await setupResponse.json()) as { activeOrgId: string };
    const setCookies = extractSetCookies(setupResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "tinyclaw_csrf");

    const getEmpty = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: withOrgId({ Cookie: cookieHeader }, setupBody.activeOrgId),
      }),
    );
    expect(getEmpty.status).toBe(200);
    const emptyBody = (await getEmpty.json()) as Record<string, unknown>;
    expect(emptyBody.configured).toBe(false);
    expect("password" in emptyBody).toBe(false);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        method: "PUT",
        headers: withOrgId(
          {
            Cookie: cookieHeader,
            "X-CSRF-Token": csrfToken,
            "Content-Type": "application/json",
          },
          setupBody.activeOrgId,
        ),
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
        headers: withOrgId(
          {
            Cookie: cookieHeader,
            "X-CSRF-Token": csrfToken,
            "Content-Type": "application/json",
          },
          setupBody.activeOrgId,
        ),
        body: JSON.stringify({
          smtpHost: "smtp2.example.com",
        }),
      }),
    );
    expect(putWithoutPassword.status).toBe(200);

    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: withOrgId({ Cookie: cookieHeader }, setupBody.activeOrgId),
      }),
    );
    const savedBody = (await getSaved.json()) as { smtpHost: string | null; passwordMasked: string | null };
    expect(savedBody.smtpHost).toBe("smtp2.example.com");
    expect(savedBody.passwordMasked).toBeTruthy();
  });
});
