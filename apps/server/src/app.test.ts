import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMinimalHonoApp } from "./http/test-app-helpers";
import { setupFreshInstallSession } from "./http/test-session-helpers";
import { setupTestConfigDir } from "./test-config-dir";

const TEST_DIST_DIR = join(import.meta.dir, "__test_dist__");

setupTestConfigDir("nakama-app-test-");

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
    const { app } = createMinimalHonoApp({ webDistDir: TEST_DIST_DIR });
    const response = await app.fetch(new Request("http://localhost:4310/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>SPA</html>");
  });

  test("GET /login returns index.html without auth token", async () => {
    const { app } = createMinimalHonoApp({ webDistDir: TEST_DIST_DIR });
    const response = await app.fetch(
      new Request("http://localhost:4310/login")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>SPA</html>");
  });

  test("GET /app.js returns the file without auth token", async () => {
    const { app } = createMinimalHonoApp({ webDistDir: TEST_DIST_DIR });
    const response = await app.fetch(
      new Request("http://localhost:4310/app.js")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log('app')");
  });

  test("GET /v1/sessions without token returns 401", async () => {
    const { app } = createMinimalHonoApp({ webDistDir: TEST_DIST_DIR });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  test("GET /v1/nonexistent without token returns 401", async () => {
    const { app } = createMinimalHonoApp({ webDistDir: TEST_DIST_DIR });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/nonexistent")
    );

    expect(response.status).toBe(401);
  });
});

async function createMockAppWithWorkerManager(workerManager: object) {
  const { app, databaseAdapter } = createMinimalHonoApp({ workerManager });
  const session = await setupFreshInstallSession(app, databaseAdapter);
  return { app, session };
}

describe("GET /v1/workers/{name}/logs", () => {
  test("returns logs for a valid worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async () => ({ stderr: "err1", stdout: "log1\nlog2" }),
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      stderr: "err1",
      stdout: "log1\nlog2",
    });
  });

  test("clamps lines parameter to valid range", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async (_name: string, lines: number) => ({
        stderr: "",
        stdout: String(lines),
      }),
      isValidWorker: (name: string) => name === "whatsapp",
    });

    const low = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=0", {
        headers: session.headers(),
      })
    );
    expect(((await low.json()) as { stdout: string }).stdout).toBe("1");

    const high = await app.fetch(
      new Request(
        "http://localhost:4310/v1/workers/whatsapp/logs?lines=99999",
        { headers: session.headers() }
      )
    );
    expect(((await high.json()) as { stdout: string }).stdout).toBe("2000");
  });

  test("rejects non-numeric lines and falls back to the default", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async (_name: string, lines: number) => ({
        stderr: "",
        stdout: String(lines),
      }),
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs?lines=abc", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as { stdout: string }).stdout).toBe("200");
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/foobar/logs", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown worker: foobar",
    });
  });

  test("returns 500 when getWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      getWorkerLogs: async () => {
        throw new Error("PM2 not available");
      },
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/logs", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "PM2 not available",
    });
  });
});

describe("POST /v1/workers/{name}/clear-logs", () => {
  test("clears logs for a valid worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      clearWorkerLogs: async () => {},
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/clear-logs", {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("returns 400 for unknown worker", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      isValidWorker: () => false,
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/foobar/clear-logs", {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown worker: foobar",
    });
  });

  test("returns 500 when clearWorkerLogs fails", async () => {
    const { app, session } = await createMockAppWithWorkerManager({
      clearWorkerLogs: async () => {
        throw new Error("PM2 flush failed");
      },
      isValidWorker: (name: string) => name === "whatsapp",
    });
    const response = await app.fetch(
      new Request("http://localhost:4310/v1/workers/whatsapp/clear-logs", {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "PM2 flush failed",
    });
  });
});
