import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { createHonoApp } from "./http/app";
import { AuthService } from "./services/auth-service";
import { seedOrgForUser, TEST_ORG_ID, withOrgId, buildSetupAuthBody } from "./http/test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  setupFreshInstallSession,
} from "./http/test-session-helpers";
import { OrgService } from "./services/org-service";

const TEST_DIST_DIR = join(import.meta.dir, "__test_dist__");
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;
let testConfigDir = "";

beforeAll(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), "tinyclaw-app-test-"));
  process.env.TINYCLAW_CONFIG_DIR = testConfigDir;
});

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.TINYCLAW_CONFIG_DIR;
  } else {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;
  }

  if (testConfigDir) {
    rmSync(testConfigDir, { recursive: true, force: true });
  }
});

function createMockApp(webDistDir: string | null) {
  const authService = new AuthService();
  return createHonoApp({
    agent: {} as any,
    automationService: {} as any,
    taskService: {} as any,
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    workerManager: {} as any,
    mcpService: {} as any,
    authService,
    orgService: {} as any,
    databaseAdapter: {
      countUsers: async () => 1,
      getUserByEmail: async () => null,
    } as any,
    webDistDir,
  });
}

function createBrowserAuthApp() {
  const authService = new AuthService();
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const app = createHonoApp({
    agent: { providerConfigured: true } as any,
    automationService: {} as any,
    taskService: {} as any,
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    workerManager: {
      isValidWorker: () => true,
      startWorker: async () => {},
    } as any,
    mcpService: {} as any,
    authService,
    orgService: new OrgService(databaseAdapter, authService),
    databaseAdapter,
    webDistDir: null,
  });

  return { app, databaseAdapter };
}

describe("static web serving before auth", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIST_DIR, "index.html"), "<html>SPA</html>");
    writeFileSync(join(TEST_DIST_DIR, "app.js"), "console.log('app')");
  });

  afterAll(() => {
    rmSync(TEST_DIST_DIR, { recursive: true, force: true });
  });

  test("GET / returns index.html without auth token", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/");
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("<html>SPA</html>");
  });

  test("GET /login returns index.html without auth token", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/login");
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("<html>SPA</html>");
  });

  test("GET /app.js returns the file without auth token", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/app.js");
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("console.log('app')");
  });

  test("GET /v1/sessions without token returns 401", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/v1/sessions");
    const response = await app.fetch(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Authentication required");
  });

  test("POST /v1/auth/login without token returns 200", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "test@test.com", password: "test" }),
    });
    const response = await app.fetch(request);

    // 401 because no user in DB, but not 401 due to missing auth
    expect(response.status).toBe(401);
  });

  test("GET /v1/nonexistent without token returns 401", async () => {
    const app = createMockApp(TEST_DIST_DIR);
    const request = new Request("http://localhost:4310/v1/nonexistent");
    const response = await app.fetch(request);

    expect(response.status).toBe(401);
  });
});

describe("browser session auth", () => {
  test("setup creates a session cookie and /v1/auth/me reads it back", async () => {
    const { app } = createBrowserAuthApp();

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );

    expect(setupResponse.status).toBe(201);
    const setupBody = (await setupResponse.json()) as { activeOrgId: string; email: string };
    expect(setupBody.activeOrgId).toStartWith("org_");
    const setCookies = extractSetCookies(setupResponse);
    expect(setCookies.some((cookie) => cookie.startsWith("tinyclaw_session="))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith("tinyclaw_csrf="))).toBe(true);

    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const meResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(meResponse.status).toBe(200);
    const meBody = (await meResponse.json()) as {
      email: string;
      activeOrgId?: string;
      isPlatformAdmin?: boolean;
      orgId?: string;
    };
    expect(meBody.email).toBe("admin@example.com");
    expect(meBody.activeOrgId).toStartWith("org_");
    expect(meBody.orgId).toBe(meBody.activeOrgId);
    expect(meBody.isPlatformAdmin).toBe(true);
  });

  test("login sets a fresh session and logout revokes it", async () => {
    const { app } = createBrowserAuthApp();

    await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
      }),
    );

    expect(loginResponse.status).toBe(200);
    const setCookies = extractSetCookies(loginResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "tinyclaw_csrf");

    const logoutResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/logout", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      }),
    );

    expect(logoutResponse.status).toBe(200);
    const afterLogout = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: { Cookie: cookieHeader },
      }),
    );

    expect(afterLogout.status).toBe(401);
  });

  test("browser sessions require CSRF on mutating routes", async () => {
    const { app, databaseAdapter } = createBrowserAuthApp();

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );
    const setupBody = (await setupResponse.json()) as { activeOrgId: string };
    const setCookies = extractSetCookies(setupResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "tinyclaw_csrf");

    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
    );
    expect(denied.status).toBe(403);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        method: "POST",
        headers: withOrgId(
          {
            Cookie: cookieHeader,
            "X-CSRF-Token": csrfToken,
          },
          setupBody.activeOrgId,
        ),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  test("platform admins can create organizations", async () => {
    const { app } = createBrowserAuthApp();

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );
    const setCookies = extractSetCookies(setupResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "tinyclaw_csrf");

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Second Org", slug: "second-org" }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { organization: { id: string; name: string } };
    expect(created.organization.name).toBe("Second Org");

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        headers: { Cookie: cookieHeader },
      }),
    );
    const listed = (await listResponse.json()) as { orgs: Array<{ id: string; name: string }> };
    expect(listed.orgs.some((org) => org.id === created.organization.id)).toBe(true);
  });

  test("non-platform users cannot create organizations", async () => {
    const { app, databaseAdapter } = createBrowserAuthApp();
    const authService = new AuthService();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const now = new Date().toISOString();

    await databaseAdapter.createUser({
      id: "user_member",
      email: "member@example.com",
      passwordHash: await authService.hashPassword("password123"),
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      orgId: session.orgId,
      userId: "user_member",
      role: "admin",
      createdAt: now,
    });

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "member@example.com", password: "password123" }),
      }),
    );
    expect(loginResponse.status).toBe(200);

    const setCookies = extractSetCookies(loginResponse);
    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(setCookies),
          "X-CSRF-Token": cookieValue(setCookies, "tinyclaw_csrf"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Blocked Org", slug: "blocked-org" }),
      }),
    );

    expect(createResponse.status).toBe(403);
  });
});

describe("GET /v1/workers/{name}/logs", () => {
  async function createMockAppWithWorkerManager(workerManager: any) {
    const authService = new AuthService();
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const app = createHonoApp({
      agent: {} as any,
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: {
        getStatus: async () => ({ ok: true }),
      } as any,
      workerManager,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    return { app, session };
  }

  test("returns logs for a valid worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: (name: string) => name === "whatsapp",
      getWorkerLogs: async () => ({ stdout: "log1\nlog2", stderr: "err1" }),
    });
    const request = new Request("http://localhost:4310/v1/workers/whatsapp/logs", {
      headers: session.headers(),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stdout).toBe("log1\nlog2");
    expect(body.stderr).toBe("err1");
  });

  test("clamps lines parameter to valid range", async () => {
    const getWorkerLogs = async (_name: string, lines: number) => ({ stdout: String(lines), stderr: "" });
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: (name: string) => name === "whatsapp",
      getWorkerLogs,
    });

    const request1 = new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=0", {
      headers: session.headers(),
    });
    const response1 = await app.fetch(request1);
    const body1 = await response1.json();
    expect(body1.stdout).toBe("1");

    const request2 = new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=99999", {
      headers: session.headers(),
    });
    const response2 = await app.fetch(request2);
    const body2 = await response2.json();
    expect(body2.stdout).toBe("2000");
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const request = new Request("http://localhost:4310/v1/workers/foobar/logs", {
      headers: session.headers(),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown worker: foobar");
  });

  test("returns 500 when getWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: (name: string) => name === "whatsapp",
      getWorkerLogs: async () => {
        throw new Error("PM2 not available");
      },
    });
    const request = new Request("http://localhost:4310/v1/workers/whatsapp/logs", {
      headers: session.headers(),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("PM2 not available");
  });
});

describe("POST /v1/workers/{name}/clear-logs", () => {
  async function createMockAppWithWorkerManager(workerManager: any) {
    const authService = new AuthService();
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const app = createHonoApp({
      agent: {} as any,
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: {
        getStatus: async () => ({ ok: true }),
      } as any,
      workerManager,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    return { app, session };
  }

  test("clears logs for a valid worker", async () => {
    const clearWorkerLogs = async () => {};
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: (name: string) => name === "whatsapp",
      clearWorkerLogs,
    });
    const request = new Request("http://localhost:4310/v1/workers/whatsapp/clear-logs", {
      method: "POST",
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const request = new Request("http://localhost:4310/v1/workers/foobar/clear-logs", {
      method: "POST",
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown worker: foobar");
  });

  test("returns 500 when clearWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: (name: string) => name === "whatsapp",
      clearWorkerLogs: async () => {
        throw new Error("PM2 flush failed");
      },
    });
    const request = new Request("http://localhost:4310/v1/workers/whatsapp/clear-logs", {
      method: "POST",
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("PM2 flush failed");
  });
});
