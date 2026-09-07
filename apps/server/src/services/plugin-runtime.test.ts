import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  derivePluginToolName,
  getOrgPluginDatabasePath,
  getOrgPluginDataDir,
  PLUGIN_MANIFEST_API_VERSION,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { zipSync } from "fflate";
import {
  PluginHostError,
  PluginService,
  resetPluginAdmissionForTests,
  vacuumPluginDatabaseInto,
} from "./plugin-service";

const echoJs = `
export async function run(input, context) {
  return {
    actorId: context.actor.id,
    actorRole: context.actor.role,
    apiVersion: context.apiVersion,
    databasePath: context.databasePath ?? null,
    dataDir: context.dataDir,
    input,
    invocationId: context.invocationId,
    orgId: context.orgId,
    pluginId: context.pluginId,
    pluginVersion: context.pluginVersion,
    profileId: context.profileId ?? null,
    sessionId: context.sessionId ?? null,
    workspaceRoot: context.workspaceRoot ?? null,
  };
}
`;

const throwJs = `
export async function run() {
  throw new Error("plugin boom");
}
`;

const badJsonJs = `
export async function run() {
  process.stdout.write("not-json");
  return { ok: true };
}
`;

const hugeJs = `
export async function run() {
  return { blob: "x".repeat(2_000_000) };
}
`;

const loopJs = `
export async function run() {
  while (true) {}
}
`;

const hangJs = `
export async function run() {
  await new Promise(() => {});
}
`;

const missingDepJs = `
import "nakama-plugin-missing-dep-u3-xyz";
export async function run() {
  return { ok: true };
}
`;

const slowJs = `
export async function run() {
  await Bun.sleep(400);
  return { ok: true };
}
`;

function encodeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = Buffer.from(value);
  }
  return zipSync(entries);
}

function manifest(id: string, extras: Record<string, unknown> = {}) {
  return {
    actions: [
      {
        access: "member",
        description: "Echo",
        effect: "read",
        entry: "actions/echo.js",
        exposeAsTool: true,
        inputSchema: {
          additionalProperties: true,
          properties: { message: { type: "string" } },
          type: "object",
        },
        key: "echo",
      },
    ],
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    author: "Nakama",
    description: "Runtime fixture",
    id,
    license: "MIT",
    minNakamaVersion: "0.1.0",
    name: id,
    skills: [],
    version: "1.0.0",
    ...extras,
  };
}

function bundle(
  id: string,
  actionSource: string,
  extras: Record<string, unknown> = {}
): Uint8Array {
  return encodeZip({
    "actions/echo.js": actionSource,
    "nakama.plugin.json": JSON.stringify(manifest(id, extras)),
  });
}

async function enablePlugin(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  orgId: string,
  pluginId: string,
  version: string
) {
  const published = await db.publishOrgPluginRelease({
    contributions: { skills: [], tools: [] },
    databaseGeneration: "gen_u3",
    expectedRevision: 0,
    lifecycleState: "enabled",
    now: new Date().toISOString(),
    orgId,
    pluginId,
    selectedVersion: version,
  });
  expect(published.ok).toBe(true);
}

describe("plugin runtime", () => {
  let configDir: string;

  beforeEach(async () => {
    resetPluginAdmissionForTests();
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u3-"));
  });

  afterEach(async () => {
    resetPluginAdmissionForTests();
    await rm(configDir, { force: true, recursive: true });
  });

  test("UI and tool adapters receive equivalent input and org context", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("echoer", echoJs));
    await enablePlugin(db, "org_a", "echoer", "1.0.0");
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "profile_1",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Default",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });
    const toolId = "tool_echoer_echo";
    await db.upsertTool({
      createdAt: now,
      description: "Echo",
      handlerConfig: { actionKey: "echo" },
      handlerType: "plugin",
      id: toolId,
      name: derivePluginToolName("echoer", "echo") ?? "plugin_echoer__echo",
      orgId: "org_a",
      pluginId: "echoer",
      pluginKey: "echo",
      updatedAt: now,
    });
    await db.assignToolToProfile("profile_1", toolId);

    const actor = { id: "user_1", role: "member" as const };
    const input = { message: "hello" };
    const ui = await service.invokePluginAction({
      access: "ui",
      actionKey: "echo",
      actor,
      input,
      orgId: "org_a",
      pluginId: "echoer",
    });
    const tool = await service.invokePluginAction({
      access: "tool",
      actionKey: "echo",
      actor,
      input,
      orgId: "org_a",
      pluginId: "echoer",
      profileId: "profile_1",
      sessionId: "session_1",
    });

    const uiResult = ui.result as Record<string, unknown>;
    const toolResult = tool.result as Record<string, unknown>;
    expect(uiResult.input).toEqual(input);
    expect(toolResult.input).toEqual(input);
    expect(uiResult.orgId).toBe("org_a");
    expect(toolResult.orgId).toBe("org_a");
    expect(uiResult.pluginId).toBe("echoer");
    expect(toolResult.pluginId).toBe("echoer");
    expect(uiResult.actorId).toBe("user_1");
    expect(toolResult.actorId).toBe("user_1");
    expect(uiResult.profileId).toBeNull();
    expect(uiResult.workspaceRoot).toBeNull();
    expect(toolResult.profileId).toBe("profile_1");
    expect(toolResult.sessionId).toBe("session_1");
    expect(toolResult.workspaceRoot).toBe(
      join(configDir, "orgs", "org_a", "profiles", "profile_1")
    );
    expect(uiResult.dataDir).toBe(
      getOrgPluginDataDir("org_a", "echoer", configDir)
    );
    expect(uiResult.databasePath).toBe(
      getOrgPluginDatabasePath("org_a", "echoer", "gen_u3", configDir)
    );
  });

  test("spoofed identity fields in input cannot change host-derived context", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("echoer", echoJs));
    await enablePlugin(db, "org_a", "echoer", "1.0.0");

    const result = (
      await service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor: { id: "user_1", role: "member" },
        input: {
          actor: { id: "spoof", role: "admin" },
          actorId: "spoof",
          context: { orgId: "spoof-org" },
          databasePath: "/tmp/evil.sqlite",
          message: "hello",
          orgId: "spoof-org",
          profileId: "spoof-profile",
          role: "admin",
          sessionId: "spoof-session",
        },
        orgId: "org_a",
        pluginId: "echoer",
      })
    ).result as Record<string, unknown>;

    expect(result.orgId).toBe("org_a");
    expect(result.actorRole).toBe("member");
    expect(result.databasePath).toBe(
      getOrgPluginDatabasePath("org_a", "echoer", "gen_u3", configDir)
    );
    expect(result.profileId).toBeNull();
    expect(result.input).toEqual({ message: "hello" });
  });

  test("bounded plugin failures leave a second plugin usable", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("broken-throw", throwJs));
    await service.installPluginPackage(bundle("broken-json", badJsonJs));
    await service.installPluginPackage(bundle("broken-huge", hugeJs));
    await service.installPluginPackage(bundle("broken-loop", loopJs));
    await service.installPluginPackage(bundle("broken-hang", hangJs));
    await service.installPluginPackage(bundle("healthy", echoJs));
    await enablePlugin(db, "org_a", "broken-throw", "1.0.0");
    await enablePlugin(db, "org_a", "broken-json", "1.0.0");
    await enablePlugin(db, "org_a", "broken-huge", "1.0.0");
    await enablePlugin(db, "org_a", "broken-loop", "1.0.0");
    await enablePlugin(db, "org_a", "broken-hang", "1.0.0");
    await enablePlugin(db, "org_a", "healthy", "1.0.0");

    const actor = { id: "user_1", role: "member" as const };
    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor,
        input: {},
        orgId: "org_a",
        pluginId: "broken-throw",
      })
    ).rejects.toBeInstanceOf(Error);

    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor,
        input: {},
        orgId: "org_a",
        pluginId: "broken-json",
      })
    ).rejects.toBeInstanceOf(Error);

    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor,
        input: {},
        orgId: "org_a",
        pluginId: "broken-huge",
      })
    ).rejects.toBeInstanceOf(Error);

    process.env.NAKAMA_CUSTOM_TOOL_TIMEOUT_MS = "200";
    try {
      await expect(
        service.invokePluginAction({
          access: "ui",
          actionKey: "echo",
          actor,
          input: {},
          orgId: "org_a",
          pluginId: "broken-loop",
        })
      ).rejects.toThrow(/timed out/i);
    } finally {
      delete process.env.NAKAMA_CUSTOM_TOOL_TIMEOUT_MS;
    }

    const controller = new AbortController();
    const hang = service.invokePluginAction({
      access: "ui",
      actionKey: "echo",
      actor,
      input: {},
      orgId: "org_a",
      pluginId: "broken-hang",
      signal: controller.signal,
    });
    controller.abort();
    await expect(hang).rejects.toBeInstanceOf(Error);

    const healthy = await service.invokePluginAction({
      access: "ui",
      actionKey: "echo",
      actor,
      input: { message: "still-works" },
      orgId: "org_a",
      pluginId: "healthy",
    });
    expect(
      (healthy.result as { input: { message: string } }).input.message
    ).toBe("still-works");
  });

  test("missing bundled dependency fails without automatic network install", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("needs-dep", missingDepJs));
    await enablePlugin(db, "org_a", "needs-dep", "1.0.0");

    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor: { id: "user_1", role: "member" },
        input: {},
        orgId: "org_a",
        pluginId: "needs-dep",
      })
    ).rejects.toThrow(/Cannot find module|Cannot find package|resolve/i);
  });

  test("runner works when copied outside the repository cwd", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "nakama-plugin-runner-"));
    try {
      const runnerSource = fileURLToPath(
        new URL("./plugin-runner.js", import.meta.url)
      );
      const runnerDest = join(elsewhere, "plugin-runner.js");
      const moduleDest = join(elsewhere, "echo.js");
      await copyFile(runnerSource, runnerDest);
      await writeFile(moduleDest, echoJs);

      const child = Bun.spawn({
        cmd: [process.execPath, "--no-install", runnerDest, moduleDest],
        cwd: tmpdir(),
        env: { PATH: process.env.PATH ?? "" },
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      });
      child.stdin.write(
        JSON.stringify({
          context: {
            actor: { id: "user_1", role: "member" },
            apiVersion: 1,
            dataDir: join(elsewhere, "data"),
            invocationId: "inv_1",
            orgId: "org_a",
            pluginId: "echoer",
            pluginVersion: "1.0.0",
          },
          input: { message: "outside" },
        })
      );
      child.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).input).toEqual({ message: "outside" });
    } finally {
      await rm(elsewhere, { force: true, recursive: true });
    }
  });

  test("rejects excess concurrent invocations and closed admission", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("slow", slowJs));
    await enablePlugin(db, "org_a", "slow", "1.0.0");

    const actor = { id: "user_1", role: "member" as const };
    const invoke = () =>
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor,
        input: {},
        orgId: "org_a",
        pluginId: "slow",
      });

    const started = [invoke(), invoke(), invoke(), invoke()];
    await Bun.sleep(50);
    const excess = invoke();
    await expect(excess).rejects.toBeInstanceOf(PluginHostError);
    await expect(excess).rejects.toMatchObject({
      code: "busy",
      retryable: true,
    });
    await Promise.all(started);

    await service.closePluginAdmission("org_a", "slow");
    await expect(invoke()).rejects.toMatchObject({
      code: "admission_closed",
    });
  });

  test("drain fails the lifecycle close when children are still active", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir, { drainTimeoutMs: 0 });
    await service.installPluginPackage(bundle("slow", slowJs));
    await enablePlugin(db, "org_a", "slow", "1.0.0");

    const hanging = service.invokePluginAction({
      access: "ui",
      actionKey: "echo",
      actor: { id: "user_1", role: "member" },
      input: {},
      orgId: "org_a",
      pluginId: "slow",
    });
    hanging.catch(() => undefined);
    await Bun.sleep(40);

    await expect(
      service.closePluginAdmission("org_a", "slow")
    ).rejects.toBeInstanceOf(PluginHostError);
    await expect(
      service.closePluginAdmission("org_a", "slow")
    ).rejects.toMatchObject({
      code: "in_use",
    });
    await Promise.allSettled([hanging]);
  });

  test("VACUUM INTO failure does not copy a live database file", async () => {
    const sourcePath = join(configDir, "live.db");
    const targetPath = join(configDir, "snapshot.db");
    await writeFile(sourcePath, "not-a-sqlite-database");

    await expect(
      vacuumPluginDatabaseInto(sourcePath, targetPath)
    ).rejects.toThrow();
    expect(existsSync(targetPath)).toBe(false);
  });

  test("disabled installations are not spawned", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(bundle("echoer", echoJs));
    const published = await db.publishOrgPluginRelease({
      contributions: { skills: [], tools: [] },
      databaseGeneration: "gen_u3",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now: new Date().toISOString(),
      orgId: "org_a",
      pluginId: "echoer",
      selectedVersion: "1.0.0",
    });
    expect(published.ok).toBe(true);

    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "echo",
        actor: { id: "user_1", role: "member" },
        input: {},
        orgId: "org_a",
        pluginId: "echoer",
      })
    ).rejects.toMatchObject({ code: "not_enabled" });
    expect(await db.getOrgPlugin("org_a", "echoer")).toMatchObject({
      lifecycleState: "disabled",
    });
  });
});
