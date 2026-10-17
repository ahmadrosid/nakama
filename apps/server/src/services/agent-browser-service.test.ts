import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../http/app";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { asTestFetch } from "../providers/test-helpers";
import {
  enrichAgentBrowserBashInput,
  getAgentBrowserInstallCommand,
  getAgentBrowserStatus,
  getSessionBrowser,
  installAgentBrowser,
  saveAgentBrowserConfig,
  stopSessionBrowser,
} from "../services/agent-browser-service";
import { AgentService } from "../services/agent-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import * as cliPackageInstall from "./cli-package-install";
import {
  waitForExit,
  waitForPidFile,
  withFastCliProbes,
} from "./coding-agent-test-fixtures";

const testPosix = test.skipIf(process.platform === "win32");

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

  // Windows terminates processes directly; it cannot exercise a SIGTERM trap.
  testPosix(
    "a CLI that traps SIGTERM is killed once the version probe times out",
    async () => {
      await withFastCliProbes(async () => {
        await installFakeBinary(tempBinDir, "agent-browser", "stubborn");
        const pidFile = join(tempBinDir, "pid");

        const started = Date.now();
        const statusPromise = getAgentBrowserStatus();
        const pid = await waitForPidFile(pidFile, 2000);
        const status = await statusPromise;

        expect(status.installed).toBe(false);
        expect(status.ready).toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(await waitForExit(pid, 2000)).toBe(true);
      });
    },
    5000
  );

  test("tells admins to install an exact version, not a floating name", () => {
    expect(getAgentBrowserInstallCommand()).toMatch(
      /^(?:npm install -g|bun install -g --trust) agent-browser@\d+\.\d+\.\d+ && agent-browser install$/
    );
  });

  test("never runs the package manager when the registry hash is not the pinned one", async () => {
    const npmRan = join(tempBinDir, "npm-ran");
    await writeFile(join(tempBinDir, "npm"), `#!/bin/sh\ntouch ${npmRan}\n`);
    await chmod(join(tempBinDir, "npm"), 0o755);
    process.env.PATH = `${tempBinDir}:${originalPath}`;

    // A registry that answers for the right version with someone else's
    // tarball, which is what a hijacked or mirrored registry looks like.
    const server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);
        const version = url.pathname.split("/").pop() ?? "";

        return Response.json({
          dist: {
            integrity:
              "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
            tarball: `${url.origin}/tarball.tgz`,
          },
          name: "agent-browser",
          version,
        });
      },
      port: 0,
    });

    try {
      await expect(
        installAgentBrowser(undefined, {
          registry: `http://localhost:${server.port}`,
        })
      ).rejects.toThrow("install refused");
      expect(existsSync(npmRan)).toBe(false);
    } finally {
      server.stop(true);
    }
  }, 20_000);
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
      // SAFETY: The test fixture matches the contract used by this test.
      automationService: {} as any,
      databaseAdapter,
      // SAFETY: The test fixture matches the contract used by this test.
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      // SAFETY: The test fixture matches the contract used by this test.
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      // SAFETY: The test fixture matches the contract used by this test.
      workerManager: {} as any,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/settings/agent-browser", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(200);

    // SAFETY: The test fixture matches the contract used by this test.
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
    await withFastCliProbes(async () => {
      await installFakeBinary(tempBinDir, "agent-browser", "hangs");

      const databaseAdapter = createInMemoryDatabaseAdapter();
      const authService = new AuthService();

      const app = createHonoApp({
        agent: new AgentService(null, null, databaseAdapter),
        authService,
        // SAFETY: The test fixture matches the contract used by this test.
        automationService: {} as any,
        databaseAdapter,
        // SAFETY: The test fixture matches the contract used by this test.
        mcpService: {} as any,
        orgService: new OrgService(databaseAdapter, authService),
        // SAFETY: The test fixture matches the contract used by this test.
        systemStatus: { getStatus: async () => ({ ok: true }) } as any,
        webDistDir: null,
        // SAFETY: The test fixture matches the contract used by this test.
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

      // SAFETY: The test fixture matches the contract used by this test.
      const body = (await response.json()) as {
        installed: boolean;
        ready: boolean;
      };

      expect(body.installed).toBe(false);
      expect(body.ready).toBe(false);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  }, 5000);

  test("install stream emits progress events", async () => {
    await installFakeBinary(tempBinDir, "npm", "noop");
    await installFakeBinary(tempBinDir, "agent-browser", "installable");

    // The pinned hash only matches the real 53 MB tarball, so the download is
    // stubbed here; the hash check has its own tests against a local registry.
    using _download = spyOn(
      cliPackageInstall,
      "downloadPinnedPackageTarball"
    ).mockResolvedValue({
      cleanup: async () => undefined,
      path: join(tempBinDir, "agent-browser.tgz"),
    });

    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();

    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      authService,
      // SAFETY: The test fixture matches the contract used by this test.
      automationService: {} as any,
      databaseAdapter,
      // SAFETY: The test fixture matches the contract used by this test.
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      // SAFETY: The test fixture matches the contract used by this test.
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      // SAFETY: The test fixture matches the contract used by this test.
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
  if (
    process.platform === "win32" &&
    (mode === "ready" || mode === "noop" || mode === "installable")
  ) {
    await writeFile(
      join(binDir, `${name}.cmd`),
      "@echo off\r\necho agent-browser 1.0.0\r\nexit /b 0\r\n"
    );

    return;
  }

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

describe("Kernel browser runtime", () => {
  const originalFetch = globalThis.fetch;
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
  const kernelEnvKeys = ["NAKAMA_BROWSER_PROVIDER", "KERNEL_API_KEY"] as const;

  const originalKernelEnv = Object.fromEntries(
    kernelEnvKeys.map((key) => [key, process.env[key]])
  );

  let configDir = "";
  let requests: Array<{ body: unknown; method: string; url: string }> = [];
  let browsers: Map<string, Record<string, string>>;

  const context = { orgId: "org-a", profileId: "agent-1", sessionId: "chat-1" };

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-kernel-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    for (const key of kernelEnvKeys) {
      delete process.env[key];
    }

    requests = [];
    browsers = new Map();

    globalThis.fetch = asTestFetch(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ body, method, url: url.pathname });

        if (url.pathname === "/profiles") {
          return Response.json({}, { status: 200 });
        }

        if (url.pathname === "/browsers" && method === "POST") {
          const created = {
            browser_live_view_url: `https://live.onkernel.com/${body.name}`,
            cdp_ws_url: `wss://cdp.onkernel.com/${body.name}`,
            session_id: `kernel-${browsers.size + 1}`,
          };

          browsers.set(body.name, created);

          return Response.json(created);
        }

        const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const browser = browsers.get(name);

        if (method === "DELETE") {
          browsers.delete(name);

          return new Response(null, { status: browser ? 204 : 404 });
        }

        return browser
          ? Response.json(browser)
          : Response.json({}, { status: 404 });
      }
    );
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;

    for (const key of kernelEnvKeys) {
      if (originalKernelEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalKernelEnv[key];
      }
    }

    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    await rm(configDir, { force: true, recursive: true });
  });

  test("leaves agent-browser on local Chrome when Kernel is not set up", async () => {
    const input = { command: "agent-browser open https://example.com" };

    expect(await enrichAgentBrowserBashInput(input, context)).toEqual(input);
    expect(requests).toHaveLength(0);
  });

  test("leaves other bash commands alone when Kernel is set up", async () => {
    await saveAgentBrowserConfig({ apiKey: "kernel-key", provider: "kernel" });
    const input = { command: "ls agent-browser-notes" };

    expect(await enrichAgentBrowserBashInput(input, context)).toEqual(input);
    expect(requests).toHaveLength(0);
  });

  test("connects agent-browser to one Kernel browser per chat session", async () => {
    await saveAgentBrowserConfig({ apiKey: "kernel-key", provider: "kernel" });
    const input = { command: "agent-browser open https://www.linkedin.com" };

    const first = await enrichAgentBrowserBashInput(input, context);
    const second = await enrichAgentBrowserBashInput(input, context);

    expect(first.env?.AGENT_BROWSER_CDP).toBe(
      "wss://cdp.onkernel.com/nakama-org-a-chat-1"
    );
    expect(first.env?.KERNEL_API_KEY).toBe("");
    expect(first.env).not.toHaveProperty("AGENT_BROWSER_PROVIDER");
    expect(second.env).toEqual(first.env);
    expect(
      requests.filter((request) => request.url === "/browsers")
    ).toHaveLength(1);
    expect(
      requests.find((request) => request.url === "/browsers")?.body
    ).toMatchObject({
      headless: false,
      profile: { name: "nakama-org-a-agent-1", save_changes: true },
    });
  });

  test("uses the Kernel key from the host env", async () => {
    process.env.NAKAMA_BROWSER_PROVIDER = "kernel";
    process.env.KERNEL_API_KEY = "env-key";

    const status = await getAgentBrowserStatus();

    const enriched = await enrichAgentBrowserBashInput(
      { command: "agent-browser snapshot -i" },
      context
    );

    expect(status.provider).toBe("kernel");
    expect(enriched.env?.AGENT_BROWSER_CDP).toBeString();
  });

  test("requires a Kernel API key to save", async () => {
    await expect(
      saveAgentBrowserConfig({ provider: "kernel" })
    ).rejects.toThrow();

    process.env.KERNEL_API_KEY = "env-key";

    await saveAgentBrowserConfig({ provider: "kernel" });
    expect((await getAgentBrowserStatus()).provider).toBe("kernel");
  });

  test("restores local Chrome when the provider is cleared", async () => {
    await saveAgentBrowserConfig({ apiKey: "kernel-key", provider: "kernel" });
    await saveAgentBrowserConfig({ provider: null });

    const status = await getAgentBrowserStatus();

    expect(status.provider).toBeNull();
    expect(status.apiKeyMasked).toBeNull();
  });

  test("does not show one org the browser of another org", async () => {
    await saveAgentBrowserConfig({ apiKey: "kernel-key", provider: "kernel" });
    await enrichAgentBrowserBashInput(
      { command: "agent-browser open x" },
      context
    );

    expect((await getSessionBrowser("org-a", "chat-1")).liveViewUrl).toBe(
      "https://live.onkernel.com/nakama-org-a-chat-1"
    );
    expect((await getSessionBrowser("org-b", "chat-1")).liveViewUrl).toBeNull();
  });

  test("stops the session browser", async () => {
    await saveAgentBrowserConfig({ apiKey: "kernel-key", provider: "kernel" });
    await enrichAgentBrowserBashInput(
      { command: "agent-browser open x" },
      context
    );

    await stopSessionBrowser("org-a", "chat-1");

    expect((await getSessionBrowser("org-a", "chat-1")).liveViewUrl).toBeNull();
  });
});
