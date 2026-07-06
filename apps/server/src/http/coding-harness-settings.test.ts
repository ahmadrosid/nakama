import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "./app";
import { setupFreshInstallSession } from "./test-session-helpers";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { AgentService } from "../services/agent-service";

describe("coding harness settings routes", () => {
  const originalPath = process.env.PATH ?? "";
  let tempBinDir = "";
  let configDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(join(tmpdir(), "nakama-coding-harness-route-bin-"));
    configDir = await mkdtemp(join(tmpdir(), "nakama-coding-harness-route-config-"));
    process.env.PATH = tempBinDir;
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    delete process.env.NAKAMA_CONFIG_DIR;

    if (tempBinDir) {
      await rm(tempBinDir, { recursive: true, force: true });
      tempBinDir = "";
    }
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }
  });

  test("org admin can read and update coding harness settings", async () => {
    await installFakeBinary(tempBinDir, "codex", "ready");

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
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        headers: session.headers(),
      }),
    );
    expect(getEmpty.status).toBe(200);
    const emptyBody = (await getEmpty.json()) as {
      configured: boolean;
      activeHarnessId: string | null;
      harnesses: Array<{ kind: string; installed: boolean }>;
    };
    expect(emptyBody.configured).toBe(true);
    expect(emptyBody.activeHarnessId).toBe("coding-harness-codex");
    expect(emptyBody.harnesses.some((harness) => harness.kind === "codex")).toBe(true);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        method: "PUT",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          selectedHarnessId: "coding-harness-codex",
          harnesses: [{ id: "coding-harness-codex", command: "codex", enabled: true }],
        }),
      }),
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as {
      configured: boolean;
      selectedHarnessId: string | null;
      harnesses: Array<{ id: string; selected: boolean; installed: boolean }>;
    };
    expect(saved.configured).toBe(true);
    expect(saved.selectedHarnessId).toBe("coding-harness-codex");
    expect(saved.harnesses.find((harness) => harness.id === "coding-harness-codex")?.selected).toBe(
      true,
    );

    const verifyResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses/verify", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          harnessId: "coding-harness-codex",
        }),
      }),
    );
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as {
      ok: boolean;
      harnessId: string | null;
      version: string | null;
      authenticated: boolean | null;
      ready: boolean;
    };
    expect(verified.ok).toBe(true);
    expect(verified.harnessId).toBe("coding-harness-codex");
    expect(verified.authenticated).toBe(true);
    expect(verified.ready).toBe(true);
  }, 15_000);

  test("verify reports login required when codex is installed but not authenticated", async () => {
    await installFakeBinary(tempBinDir, "codex", "login-required");

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

    const getResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses", {
        headers: session.headers(),
      }),
    );
    expect(getResponse.status).toBe(200);
    const settings = (await getResponse.json()) as {
      configured: boolean;
      activeHarnessId: string | null;
    };
    expect(settings.configured).toBe(false);
    expect(settings.activeHarnessId).toBeNull();

    const verifyResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/coding-harnesses/verify", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          harnessId: "coding-harness-codex",
        }),
      }),
    );
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as {
      ok: boolean;
      authenticated: boolean | null;
      ready: boolean;
      nextStep: string | null;
      error: string | null;
    };
    expect(verified.ok).toBe(false);
    expect(verified.authenticated).toBe(false);
    expect(verified.ready).toBe(false);
    expect(verified.nextStep).toBe("login");
    expect(verified.error).toContain("codex login");
  }, 15_000);
});

async function installFakeBinary(
  binDir: string,
  name: string,
  mode: "ready" | "login-required",
): Promise<void> {
  const scriptPath = join(binDir, name);
  const body =
    mode === "ready"
      ? [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "codex 0.1.0"',
          "  exit 0",
          "fi",
          "echo OK",
          "exit 0",
        ]
      : [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "codex 0.1.0"',
          "  exit 0",
          "fi",
          'echo "Please run codex login" 1>&2',
          "exit 1",
        ];
  await writeFile(
    scriptPath,
    body.join("\n"),
  );
  await chmod(scriptPath, 0o755);
}
