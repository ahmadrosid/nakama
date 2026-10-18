import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";
import { claimChannelIdentity } from "@nakama/core/channel-config-shared";
import { saveWhatsAppConfig } from "@nakama/core/whatsapp-config";
import { WorkerManagerService } from "./worker-manager-service";

type Pm2Client = NonNullable<
  ConstructorParameters<typeof WorkerManagerService>[1]
>;

function createMockPm2() {
  const mockPm2 = {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    delete: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    describe: mock((_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
      cb(null, [])
    ),
    disconnect: mock(() => {}),
    flush: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: Parameters<Pm2Client["list"]>[0]) => cb(null, [])),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    start: mock(
      (
        _opts: Parameters<Pm2Client["start"]>[0],
        cb: (err: Error | null) => void
      ) => cb(null)
    ),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
  };

  return mockPm2;
}

const projectRoot = "/tmp/test-project";

let configDir: string | null = null;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "nakama-worker-manager-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

test("plugin workers are isolated, recover desired state, and unregister without deleting data", async () => {
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);

  const registration = {
    dataDir: join(configDir!, "notes-a"),
    orgId: "org-a",
    pluginId: "notes",
    releaseDir: configDir!,
    version: "1.0.0",
    workers: [{ entry: "worker.js", key: "indexer", name: "Notes indexer" }],
  };

  await writeFile(join(configDir!, "worker.js"), "");
  await service.registerPluginWorkers(registration, true);
  const [a] = await service.listPluginWorkers("org-a");
  expect(a!.name).toMatch(/^plugin-/);
  expect(service.isPluginWorkerForOrg(a!.name, "org-b")).toBe(false);
  await service.registerPluginWorkers(
    { ...registration, dataDir: join(configDir!, "notes-b"), orgId: "org-b" },
    true
  );
  const [b] = await service.listPluginWorkers("org-b");
  expect(a!.name).not.toBe(b!.name);
  pm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
    cb(null, [
      { name: a!.name, pm2_env: { status: "waiting restart" } },
      { name: b!.name, pm2_env: { status: "stopped" } },
    ])
  );
  const paused = await service.pausePluginWorkers();
  expect(paused).toEqual([a!.name]);
  expect(pm2.stop).toHaveBeenCalledWith(a!.name, expect.any(Function));
  await expect(service.startWorker(b!.name)).rejects.toThrow("disabled");
  await service.resumePluginWorkers(paused);
  await service.stopWorker(a!.name);
  // SAFETY: The test fixture matches the contract used by this test.
  const starts = (pm2.start as ReturnType<typeof mock>).mock.calls.length;
  await service.registerPluginWorkers(registration, false);
  // SAFETY: The test fixture matches the contract used by this test.
  expect((pm2.start as ReturnType<typeof mock>).mock.calls).toHaveLength(
    starts
  );
  await writeFile(join(registration.dataDir, "keep.txt"), "retained");
  await service.unregisterPluginWorkers("org-a", "notes");
  expect(service.isValidWorker(a!.name)).toBe(false);
  expect(await Bun.file(join(registration.dataDir, "keep.txt")).text()).toBe(
    "retained"
  );
  expect(service.isValidWorker(b!.name)).toBe(true);
});

test("Supermemory receives only the requested OpenAI configuration on each start", async () => {
  const llm = mock(
    (
      type?: "openai"
    ): ReturnType<
      NonNullable<ConstructorParameters<typeof WorkerManagerService>[2]>
    > =>
      type === "openai"
        ? { apiKey: "test-key", model: "test-model", type: "openai" }
        : {
            apiKey: "restricted",
            model: "restricted-model",
            type: "openai_compatible",
          }
  );

  const service = new WorkerManagerService(projectRoot, createMockPm2(), llm);
  await writeFile(join(configDir!, "worker.js"), "");
  const dataDir = join(configDir!, "supermemory");
  await service.registerPluginWorkers(
    {
      dataDir,
      orgId: "org",
      pluginId: "supermemory",
      releaseDir: configDir!,
      version: "0.1.0",
      workers: [{ entry: "worker.js", key: "server", name: "Supermemory" }],
    },
    true
  );
  expect(llm).toHaveBeenCalledWith("openai");
  expect(
    await Bun.file(join(dataDir, "workers/server/auto-provider.json")).json()
  ).toEqual({ apiKey: "test-key", model: "test-model", type: "openai" });
});

test("migration preserves an unambiguous connection and leaves ambiguous credentials stopped", async () => {
  const { createInMemoryDatabaseAdapter } = await import("@nakama/db");

  const { saveTelegramConfig, loadTelegramConfigFile } = await import(
    "@nakama/core/telegram-config"
  );

  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  for (const id of ["org_a", "org_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      slug: id,
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: `agent_${id}`,
      isDefault: true,
      isSuper: false,
      model: "test",
      name: id,
      orgId: id,
      systemPrompt: "",
      updatedAt: now,
    });
  }

  await saveTelegramConfig(null, {
    botToken: "111:legacy",
    profileId: "default",
  });
  await saveWhatsAppConfig({ profileId: "agent_org_a" }, "org_a");
  await setWorkerDesiredRunning("whatsapp", true, "org_a");
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);
  await service.migrateAgentChannels(db);
  expect(await service.legacyChannels("org_a", true)).toEqual([
    { global: true, platform: "telegram" },
  ]);
  const owner = { orgId: "org_a", profileId: "agent_org_a" };
  expect((await readWorkerDesiredState(owner)).whatsapp).toBe(true);
  expect(pm2.start).not.toHaveBeenCalled();
  await service.claimLegacyChannel("telegram", null, owner, db);
  expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:legacy");
  expect(await loadTelegramConfigFile(null)).toBeNull();
  await service.migrateAgentChannels(db);
  expect(await service.legacyChannels("org_a", true)).toEqual([]);
  await service.disconnectChannel("telegram", owner);
  expect(await loadTelegramConfigFile(owner)).toBeNull();
  await saveTelegramConfig(
    { orgId: "org_b", profileId: "agent_org_b" },
    { botToken: "111:rotated" }
  );
});

test("Telegram migration changes only Telegram notification destinations", async () => {
  const { createInMemoryDatabaseAdapter } = await import("@nakama/db");
  const { saveTelegramConfig } = await import("@nakama/core/telegram-config");
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: "org_a",
    name: "A",
    slug: "a",
    updatedAt: now,
  });
  await db.upsertProfile({
    createdAt: now,
    id: "agent_a",
    isDefault: true,
    isSuper: false,
    model: "test",
    name: "A",
    orgId: "org_a",
    systemPrompt: "",
    updatedAt: now,
  });

  const fields = {
    createdAt: now,
    name: "Notifications",
    orgId: "org_a",
    secretHash: "hash",
    updatedAt: now,
  };

  await db.upsertNotificationDestination({
    ...fields,
    channel: "telegram",
    config: { chatId: 1001 },
    id: "telegram",
  });
  await db.upsertNotificationDestination({
    ...fields,
    channel: "discord",
    config: { channelId: "123", profileId: "" },
    id: "discord",
  });
  await db.upsertNotificationDestination({
    ...fields,
    channel: "whatsapp",
    config: { profileId: "" },
    id: "whatsapp",
  });
  await saveTelegramConfig("org_a", {
    botToken: "111:legacy",
    profileId: "default",
  });

  await new WorkerManagerService(
    projectRoot,
    createMockPm2()
  ).migrateAgentChannels(db);

  const destinations = await db.listNotificationDestinationsForOrg("org_a");
  expect(
    destinations.find((destination) => destination.id === "telegram")?.config
  ).toEqual({ chatId: 1001, profileId: "agent_a" });
  expect(
    destinations.find((destination) => destination.id === "discord")?.config
  ).toEqual({ channelId: "123", profileId: "" });
  expect(
    destinations.find((destination) => destination.id === "whatsapp")?.config
  ).toEqual({ profileId: "" });
});

test("migration archives duplicate legacy WhatsApp credentials when the claimed agent is connected", async () => {
  const { createInMemoryDatabaseAdapter } = await import("@nakama/db");
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  for (const [orgId, profileId] of [
    ["org_a", "agent_a"],
    ["org_b", "agent_b"],
  ]) {
    await db.upsertOrganization({
      createdAt: now,
      id: orgId!,
      name: orgId!,
      slug: orgId!,
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: profileId!,
      isDefault: true,
      isSuper: false,
      model: "test",
      name: profileId!,
      orgId: orgId!,
      systemPrompt: "",
      updatedAt: now,
    });
  }

  const legacyDir = join(configDir!, "orgs", "org_a", "whatsapp");
  const active = { orgId: "org_b", profileId: "agent_b" };

  const activeDir = join(
    configDir!,
    "orgs",
    "org_b",
    "channels",
    "agent_b",
    "whatsapp"
  );

  await saveWhatsAppConfig({ profileId: "agent_a" }, "org_a");
  await saveWhatsAppConfig({}, active);
  await mkdir(join(legacyDir, "auth"), { recursive: true });
  await writeFile(
    join(legacyDir, "auth", "creds.json"),
    JSON.stringify({ me: { id: "123:4@s.whatsapp.net" } })
  );
  await claimChannelIdentity("whatsapp", active, "123@s.whatsapp.net");
  await setWorkerDesiredRunning("whatsapp", true, "org_a");

  const service = new WorkerManagerService(projectRoot, createMockPm2());
  await expect(
    service.claimLegacyChannel(
      "whatsapp",
      "org_a",
      {
        orgId: "org_a",
        profileId: "agent_a",
      },
      db
    )
  ).rejects.toThrow();
  expect(await Bun.file(join(legacyDir, "config.ini")).exists()).toBe(true);
  await mkdir(join(activeDir, "auth"), { recursive: true });
  await writeFile(
    join(activeDir, "auth", "creds.json"),
    JSON.stringify({ me: { id: "123:4@s.whatsapp.net" } })
  );
  await service.migrateAgentChannels(db);

  expect(await service.legacyChannels("org_a", false)).toEqual([]);

  const archived = (await readdir(join(configDir!, "orgs", "org_a"))).find(
    (name) => name.startsWith("whatsapp.duplicate-")
  );

  expect(archived).toBeDefined();
  expect(
    await Bun.file(
      join(configDir!, "orgs", "org_a", archived!, "auth", "creds.json")
    ).exists()
  ).toBe(true);
  expect(await Bun.file(join(activeDir, "config.ini")).exists()).toBe(true);
  expect((await readWorkerDesiredState("org_a")).whatsapp).toBe(false);
});

test("failed stop preserves credentials and blocks owner recovery", async () => {
  const owner = { orgId: "org_a", profileId: "agent_a" };
  await saveWhatsAppConfig({}, owner);
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);
  // SAFETY: The test fixture matches the contract used by this test.
  (pm2.describe as ReturnType<typeof mock>).mockImplementation((_name, cb) =>
    cb(null, [{}])
  );
  // SAFETY: The test fixture matches the contract used by this test.
  (pm2.delete as ReturnType<typeof mock>).mockImplementation((_name, cb) =>
    cb(new Error("stop failed"))
  );
  await expect(service.disableProfileChannels(owner, true)).rejects.toThrow();

  const { loadWhatsAppConfigFile } = await import(
    "@nakama/core/whatsapp-config"
  );

  expect(await loadWhatsAppConfigFile(owner)).not.toBeNull();
  await expect(service.startWorker("whatsapp", owner)).rejects.toThrow();
  expect((await readWorkerDesiredState(owner)).whatsapp).toBe(false);
  expect(pm2.start).not.toHaveBeenCalled();
});

test("stopped agent logs remain available and clearing keeps sibling logs", async () => {
  const { getChannelConfigDir } = await import(
    "@nakama/core/channel-config-shared"
  );

  const a = { orgId: "org_a", profileId: "agent_a" };
  const b = { orgId: "org_a", profileId: "agent_b" };

  for (const owner of [a, b]) {
    await saveWhatsAppConfig({}, owner);
    await writeFile(
      join(getChannelConfigDir("whatsapp", owner), "stdout.log"),
      owner.profileId + "\n"
    );
  }

  const service = new WorkerManagerService(projectRoot, createMockPm2());
  await service.stopWorker("whatsapp", a);
  expect((await service.getWorkerLogs("whatsapp", 20, a)).stdout).toBe(
    "agent_a"
  );
  await service.clearWorkerLogs("whatsapp", a);
  expect((await service.getWorkerLogs("whatsapp", 20, a)).stdout).toBe("");
  expect((await service.getWorkerLogs("whatsapp", 20, b)).stdout).toBe(
    "agent_b"
  );
});
