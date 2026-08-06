import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../http/app";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { AgentService } from "../services/agent-service";
import {
  getAgentBrowserInstallCommand,
  getAgentBrowserStatus,
} from "../services/agent-browser-service";

describe("agent-browser service", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(join(tmpdir(), "nakama-agent-browser-bin-"));
    process.env.PATH = tempBinDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (originalDisableFixPath === undefined) {
      delete process.env.NAKAMA_DISABLE_FIX_PATH;
    } else {
      process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
    }

    if (tempBinDir) {
      await rm(tempBinDir, { recursive: true, force: true });
      tempBinDir = "";
    }
  });

  test("reports not ready when agent-browser is missing", async () => {
    const status = await getAgentBrowserStatus();

    expect(status.installed).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.nextStep).toBe("install");
    expect(status.installCommand).toBe(getAgentBrowserInstallCommand());
  });

  test("reports ready when agent-browser responds to --version", async () => {
    await installFakeBinary(tempBinDir, "agent-browser", "ready");

    const status = await getAgentBrowserStatus();

    expect(status.installed).toBe(true);
    expect(status.version).toBe("agent-browser 1.0.0");
    expect(status.ready).toBe(true);
    expect(status.nextStep).toBeNull();
  });
});

describe("agent-browser settings routes", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";
  let configDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(join(tmpdir(), "nakama-agent-browser-route-bin-"));
    configDir = await mkdtemp(join(tmpdir(), "nakama-agent-browser-route-config-"));
    process.env.PATH = tempBinDir;
    process.env.NAKAMA_CONFIG_DIR = configDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (originalDisableFixPath === undefined) {
      delete process.env.NAKAMA_DISABLE_FIX_PATH;
    } else {
      process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
    }
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

  test("org admin can read agent-browser status", async () => {
    await installFakeBinary(tempBinDir, "agent-browser", "ready");

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

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser", {
        headers: session.headers(),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      installed: boolean;
      ready: boolean;
      version: string | null;
    };
    expect(body.installed).toBe(true);
    expect(body.ready).toBe(true);
    expect(body.version).toBe("agent-browser 1.0.0");
  });

  test("install stream emits progress events", async () => {
    await installFakeBinary(tempBinDir, "npm", "noop");
    await installFakeBinary(tempBinDir, "agent-browser", "installable");

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

    const installResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser/install", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          Accept: "text/event-stream",
        }),
      }),
    );

    expect(installResponse.status).toBe(200);
    const body = await installResponse.text();
    expect(body).toContain('"type":"progress"');
    expect(body).toContain('"type":"done"');
  }, 15_000);
});

async function installFakeBinary(
  binDir: string,
  name: string,
  mode: "ready" | "login-required" | "noop" | "installable",
): Promise<void> {
  const scriptPath = join(binDir, name);
  let script = "";

  if (mode === "ready") {
    script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "agent-browser 1.0.0"
  exit 0
fi
echo "unexpected args: $@" >&2
exit 1
`;
  } else if (mode === "login-required") {
    script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "please log in" >&2
  exit 1
fi
exit 1
`;
  } else if (mode === "noop") {
    script = `#!/bin/sh
exit 0
`;
  } else if (mode === "installable") {
    script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "agent-browser 1.0.0"
  exit 0
fi
if [ "$1" = "install" ]; then
  echo "installed chrome"
  exit 0
fi
exit 0
`;
  }

  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
}
