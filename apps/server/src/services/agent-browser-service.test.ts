import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../http/app";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import {
  getAgentBrowserInstallCommand,
  getAgentBrowserStatus,
} from "../services/agent-browser-service";
import { AgentService } from "../services/agent-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";

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
      await rm(tempBinDir, { force: true, recursive: true });
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

  test("a CLI that traps SIGTERM is killed once the version probe times out", async () => {
    await installFakeBinary(tempBinDir, "agent-browser", "stubborn");
    const pidFile = join(tempBinDir, "pid");

    const started = Date.now();
    const status = await getAgentBrowserStatus();

    expect(status.installed).toBe(false);
    expect(status.ready).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);

    const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
    expect(Number.isInteger(pid)).toBe(true);
    expect(await waitForExit(pid, 15_000)).toBe(true);
  }, 45_000);
});

describe("agent-browser settings routes", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";
  let configDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(
      join(tmpdir(), "nakama-agent-browser-route-bin-")
    );
    configDir = await mkdtemp(
      join(tmpdir(), "nakama-agent-browser-route-config-")
    );
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
      await rm(tempBinDir, { force: true, recursive: true });
      tempBinDir = "";
    }
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  test("org admin can read agent-browser status", async () => {
    await installFakeBinary(tempBinDir, "agent-browser", "ready");

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser", {
        headers: session.headers(),
      })
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

  test("org admin status request returns when agent-browser hangs", async () => {
    await installFakeBinary(tempBinDir, "agent-browser", "hangs");

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);
    const started = Date.now();

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      installed: boolean;
      ready: boolean;
    };
    expect(body.installed).toBe(false);
    expect(body.ready).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);

  test("install stream emits progress events", async () => {
    await installFakeBinary(tempBinDir, "npm", "noop");
    await installFakeBinary(tempBinDir, "agent-browser", "installable");

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      workerManager: {} as any,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const installResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser/install", {
        headers: session.headers({
          Accept: "text/event-stream",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
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
  mode:
    | "ready"
    | "login-required"
    | "noop"
    | "installable"
    | "hangs"
    | "stubborn"
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
  } else if (mode === "hangs") {
    // Direct Node process so SIGTERM hits this PID. A shell wrapper would
    // leave `sleep` running after kill(), and PATH in these tests is only
    // the stub dir so `sleep` would not be found anyway.
    script = `#!${process.execPath}
setInterval(() => {}, 1000);
`;
  } else if (mode === "stubborn") {
    // Hangs on --version and swallows SIGTERM, so only the SIGKILL escalation
    // ends it. It records its own pid because the probe never exposes the child.
    const pidFile = join(binDir, "pid");
    script = `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`;
  }

  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
