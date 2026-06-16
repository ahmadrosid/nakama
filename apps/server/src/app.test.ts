import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app";
import { AuthService } from "./services/auth-service";

const TEST_DIST_DIR = join(import.meta.dir, "__test_dist__");

const TEST_CONFIG = {
  jwtSecret: "test-secret-key-for-jwt-signing-1234567890",
};

function createMockApp(webDistDir: string | null) {
  const authService = new AuthService(TEST_CONFIG);
  return createApp({
    agent: {} as any,
    automationService: {} as any,
    taskService: {} as any,
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    workerManager: {} as any,
    mcpService: {} as any,
    authService,
    databaseAdapter: {
      countUsers: async () => 1,
      getUserByEmail: async () => null,
    } as any,
    webDistDir,
  });
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
