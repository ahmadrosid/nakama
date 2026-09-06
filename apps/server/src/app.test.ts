import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "./http/app";
import { buildSetupAuthBody, withOrgId } from "./http/test-org-helpers";
import {
  cookieHeaderFromSetCookies,
  cookieValue,
  extractSetCookies,
  setupFreshInstallSession,
} from "./http/test-session-helpers";
import { AuthService } from "./services/auth-service";
import { OrgService } from "./services/org-service";

const TEST_DIST_DIR = join(import.meta.dir, "__test_dist__");
const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
let testConfigDir = "";

beforeAll(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), "nakama-app-test-"));
  process.env.NAKAMA_CONFIG_DIR = testConfigDir;
});

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
  }

  if (testConfigDir) {
    rmSync(testConfigDir, { force: true, recursive: true });
  }
});

function createMockApp(webDistDir: string | null) {
  const authService = new AuthService();
  return createHonoApp({
    agent: {} as any,
    authService,
    automationService: {} as any,
    databaseAdapter: {
      countHumanUsers: async () => 1,
      countUsers: async () => 1,
      getUserByEmail: async () => null,
    } as any,
    mcpService: {} as any,
    orgService: {} as any,
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    webDistDir,
    workerManager: {} as any,
  });
}

function createBrowserAuthApp() {
  const authService = new AuthService();
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const app = createHonoApp({
    agent: { providerConfigured: true } as any,
    authService,
    automationService: {} as any,
    databaseAdapter,
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    webDistDir: null,
    workerManager: {
      isValidWorker: () => true,
      startWorker: async () => {},
    } as any,
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
    rmSync(TEST_DIST_DIR, { force: true, recursive: true });
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
        body: JSON.stringify(buildSetupAuthBody()),
        method: "POST",
      })
    );

    expect(setupResponse.status).toBe(201);
    const setupBody = (await setupResponse.json()) as {
      activeOrgId: string;
      email: string;
    };
    expect(setupBody.activeOrgId).toStartWith("org_");
    const setCookies = extractSetCookies(setupResponse);
    expect(
      setCookies.some((cookie) => cookie.startsWith("nakama_session="))
    ).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith("nakama_csrf="))).toBe(
      true
    );

    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const meResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: { Cookie: cookieHeader },
      })
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
        body: JSON.stringify(buildSetupAuthBody()),
        method: "POST",
      })
    );

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(loginResponse.status).toBe(200);
    const setCookies = extractSetCookies(loginResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "nakama_csrf");

    const logoutResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/logout", {
        headers: {
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      })
    );

    expect(logoutResponse.status).toBe(200);
    const afterLogout = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: { Cookie: cookieHeader },
      })
    );

    expect(afterLogout.status).toBe(401);
  });

  test("browser sessions require CSRF on mutating routes", async () => {
    const { app, databaseAdapter } = createBrowserAuthApp();

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        body: JSON.stringify(buildSetupAuthBody()),
        method: "POST",
      })
    );
    const setupBody = (await setupResponse.json()) as { activeOrgId: string };
    const setCookies = extractSetCookies(setupResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "nakama_csrf");

    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        headers: { Cookie: cookieHeader },
        method: "POST",
      })
    );
    expect(denied.status).toBe(403);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/start", {
        headers: withOrgId(
          {
            Cookie: cookieHeader,
            "X-CSRF-Token": csrfToken,
          },
          setupBody.activeOrgId
        ),
        method: "POST",
      })
    );
    expect(allowed.status).toBe(200);
  });

  test("platform admins can create organizations", async () => {
    const { app } = createBrowserAuthApp();

    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        body: JSON.stringify(buildSetupAuthBody()),
        method: "POST",
      })
    );
    const setCookies = extractSetCookies(setupResponse);
    const cookieHeader = cookieHeaderFromSetCookies(setCookies);
    const csrfToken = cookieValue(setCookies, "nakama_csrf");

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        body: JSON.stringify({ name: "Second Org", slug: "second-org" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      organization: { id: string; name: string };
    };
    expect(created.organization.name).toBe("Second Org");

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        headers: { Cookie: cookieHeader },
      })
    );
    const listed = (await listResponse.json()) as {
      orgs: Array<{ id: string; name: string }>;
    };
    expect(listed.orgs.some((org) => org.id === created.organization.id)).toBe(
      true
    );
  });

  test("non-platform users cannot create organizations", async () => {
    const { app, databaseAdapter } = createBrowserAuthApp();
    const authService = new AuthService();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const now = new Date().toISOString();

    await databaseAdapter.createUser({
      createdAt: now,
      email: "member@example.com",
      id: "user_member",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: session.orgId,
      role: "admin",
      userId: "user_member",
    });

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(loginResponse.status).toBe(200);

    const setCookies = extractSetCookies(loginResponse);
    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        body: JSON.stringify({ name: "Blocked Org", slug: "blocked-org" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeaderFromSetCookies(setCookies),
          "X-CSRF-Token": cookieValue(setCookies, "nakama_csrf"),
        },
        method: "POST",
      })
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
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: {
        getStatus: async () => ({ ok: true }),
      } as any,
      webDistDir: null,
      workerManager,
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    return { app, session };
  }

  test("returns logs for a valid worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async () => ({ stderr: "err1", stdout: "log1\nlog2" }),
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/whatsapp/logs",
      {
        headers: session.headers(),
      }
    );
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stdout).toBe("log1\nlog2");
    expect(body.stderr).toBe("err1");
  });

  test("clamps lines parameter to valid range", async () => {
    const getWorkerLogs = async (_name: string, lines: number) => ({
      stderr: "",
      stdout: String(lines),
    });
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs,
      isValidWorker: (name: string) => name === "whatsapp",
    });

    const request1 = new Request(
      "http://localhost:4310/v1/workers/whatsapp/logs?lines=0",
      {
        headers: session.headers(),
      }
    );
    const response1 = await app.fetch(request1);
    const body1 = await response1.json();
    expect(body1.stdout).toBe("1");

    const request2 = new Request(
      "http://localhost:4310/v1/workers/whatsapp/logs?lines=99999",
      {
        headers: session.headers(),
      }
    );
    const response2 = await app.fetch(request2);
    const body2 = await response2.json();
    expect(body2.stdout).toBe("2000");
  });

  test("rejects non-numeric lines and falls back to the default", async () => {
    const getWorkerLogs = async (_name: string, lines: number) => ({
      stderr: "",
      stdout: String(lines),
    });
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs,
      isValidWorker: (name: string) => name === "whatsapp",
    });

    const request = new Request(
      "http://localhost:4310/v1/workers/whatsapp/logs?lines=abc",
      {
        headers: session.headers(),
      }
    );
    const response = await app.fetch(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stdout).toBe("200");
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/foobar/logs",
      {
        headers: session.headers(),
      }
    );
    const response = await app.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown worker: foobar");
  });

  test("returns 500 when getWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async () => {
        throw new Error("PM2 not available");
      },
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/whatsapp/logs",
      {
        headers: session.headers(),
      }
    );
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
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: {
        getStatus: async () => ({ ok: true }),
      } as any,
      webDistDir: null,
      workerManager,
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    return { app, session };
  }

  test("clears logs for a valid worker", async () => {
    const clearWorkerLogs = async () => {};
    const { app, session } = await createMockAppWithWorkerManager({
      clearWorkerLogs,
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/whatsapp/clear-logs",
      {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      }
    );
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/foobar/clear-logs",
      {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      }
    );
    const response = await app.fetch(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown worker: foobar");
  });

  test("returns 500 when clearWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      clearWorkerLogs: async () => {
        throw new Error("PM2 flush failed");
      },
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const request = new Request(
      "http://localhost:4310/v1/workers/whatsapp/clear-logs",
      {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      }
    );
    const response = await app.fetch(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("PM2 flush failed");
  });
});
