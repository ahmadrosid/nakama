import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
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
    tempBinDir = await mkdtemp(join(tmpdir(), "tinyclaw-coding-harness-route-bin-"));
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-coding-harness-route-config-"));
    process.env.PATH = `${tempBinDir}:${originalPath}`;
    process.env.TINYCLAW_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    delete process.env.TINYCLAW_CONFIG_DIR;

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
    await installFakeBinary(tempBinDir, "codex");

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
      harnesses: Array<{ kind: string; installed: boolean }>;
    };
    expect(emptyBody.configured).toBe(false);
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
  });
});

async function installFakeBinary(binDir: string, name: string): Promise<void> {
  const scriptPath = join(binDir, name);
  await writeFile(
    scriptPath,
    ['#!/bin/sh', 'if [ "$1" = "--version" ]; then', '  exit 0', "fi", "exit 0"].join("\n"),
  );
  await chmod(scriptPath, 0o755);
}
