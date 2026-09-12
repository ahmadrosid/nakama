import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOrgPluginDatabasePath,
  getOrgPluginDataDir,
  PLUGIN_MANIFEST_API_VERSION,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { pluginPackage } from "../testing/plugin-package-fixture";
import {
  PluginHostError,
  PluginService,
  resetPluginAdmissionForTests,
  runWithPluginExportBarrier,
  setPluginLifecycleTestHooks,
} from "./plugin-service";
import { WorkerManagerService } from "./worker-manager-service";

const MIGRATION_001 = `
CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  body TEXT NOT NULL
);
`;

const MIGRATION_002 = `
CREATE TABLE extra (
  id TEXT PRIMARY KEY NOT NULL
);
`;

const MIGRATION_002_FAIL = `
CREATE TABLE extra (
  id TEXT PRIMARY KEY NOT NULL
);
INSERT INTO extra (id) VALUES ('x');
SELECT * FROM __nakama_missing_table;
`;

const MIGRATION_COMMIT_THEN_FAIL = `
CREATE TABLE leaked (
  id TEXT PRIMARY KEY NOT NULL
);
INSERT INTO leaked (id) VALUES ('oops');
COMMIT;
SELECT * FROM __nakama_missing_table;
`;

const writeJs = `
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function run(input, context) {
  const db = new Database(context.databasePath);
  db.run("INSERT INTO items (id, body) VALUES (?, ?)", [input.id, input.body]);
  writeFileSync(join(context.dataDir, \`\${input.id}.txt\`), input.body);
  const rows = db.query("SELECT id, body FROM items ORDER BY id").all();
  db.close();
  return { dataDir: context.dataDir, rows };
}
`;

const extraJs = `
export async function run() {
  return { extra: true };
}
`;

const hangActionJs = `
export async function run() {
  await new Promise(() => {});
}
`;

function baseManifest(
  id: string,
  version: string,
  extras: Record<string, unknown> = {}
) {
  return {
    actions: [
      {
        access: "member",
        description: "Write an item",
        effect: "write",
        entry: "actions/write.js",
        exposeAsTool: true,
        inputSchema: {
          properties: {
            body: { type: "string" },
            id: { type: "string" },
          },
          required: ["id", "body"],
          type: "object",
        },
        key: "write",
      },
    ],
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    author: "Nakama",
    database: {
      migrations: [{ id: "001_items", path: "migrations/001_items.sql" }],
    },
    description: "Lifecycle fixture",
    id,
    license: "MIT",
    minNakamaVersion: "0.1.0",
    name: id,
    skills: [{ directory: "skills/notes", key: "notes" }],
    version,
    ...extras,
  };
}

function v1Bundle(id = "notes"): ReturnType<typeof pluginPackage> {
  return pluginPackage({
    "actions/write.js": writeJs,
    "migrations/001_items.sql": MIGRATION_001,
    "nakama.plugin.json": JSON.stringify(baseManifest(id, "1.0.0")),
    "skills/notes/SKILL.md": "# Notes\n",
  });
}

function v2Bundle(options: {
  extraAction?: boolean;
  failSecondMigration?: boolean;
  id?: string;
  version?: string;
}): ReturnType<typeof pluginPackage> {
  const id = options.id ?? "notes";
  const version = options.version ?? "1.1.0";
  const extras: Record<string, unknown> = {};
  if (options.extraAction) {
    extras.actions = [
      ...baseManifest(id, version).actions,
      {
        access: "member",
        description: "Extra",
        effect: "read",
        entry: "actions/extra.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "extra",
      },
    ];
  }
  extras.database = {
    migrations: [
      { id: "001_items", path: "migrations/001_items.sql" },
      { id: "002_extra", path: "migrations/002_extra.sql" },
    ],
  };
  const manifest = baseManifest(id, version, extras);
  return pluginPackage({
    "actions/extra.js": extraJs,
    "actions/write.js": writeJs,
    "migrations/001_items.sql": MIGRATION_001,
    "migrations/002_extra.sql": options.failSecondMigration
      ? MIGRATION_002_FAIL
      : MIGRATION_002,
    "nakama.plugin.json": JSON.stringify(manifest),
    "skills/notes/SKILL.md": "# Notes\n",
  });
}

function codeOnlyBundle(id = "notes"): ReturnType<typeof pluginPackage> {
  return pluginPackage({
    "actions/write.js": `${writeJs}\n`,
    "migrations/001_items.sql": MIGRATION_001,
    "nakama.plugin.json": JSON.stringify(baseManifest(id, "1.0.1")),
    "skills/notes/SKILL.md": "# Notes v2\n",
  });
}

function commitThenFailBundle(id = "notes"): ReturnType<typeof pluginPackage> {
  const extras = {
    database: {
      migrations: [
        { id: "001_items", path: "migrations/001_items.sql" },
        { id: "002_leaked", path: "migrations/002_leaked.sql" },
      ],
    },
  };
  return pluginPackage({
    "actions/write.js": writeJs,
    "migrations/001_items.sql": MIGRATION_001,
    "migrations/002_leaked.sql": MIGRATION_COMMIT_THEN_FAIL,
    "nakama.plugin.json": JSON.stringify(baseManifest(id, "1.2.0", extras)),
    "skills/notes/SKILL.md": "# Notes\n",
  });
}

function hangActionBundle(id = "notes"): ReturnType<typeof pluginPackage> {
  const manifest = baseManifest(id, "1.0.0");
  return pluginPackage({
    "actions/write.js": hangActionJs,
    "migrations/001_items.sql": MIGRATION_001,
    "nakama.plugin.json": JSON.stringify(manifest),
    "skills/notes/SKILL.md": "# Notes\n",
  });
}

const actor = { id: "admin_1", role: "admin" as const };

async function added(
  service: PluginService,
  orgId: string,
  pluginId: string,
  version?: string
) {
  return service.addOrgPlugin(orgId, pluginId, version);
}

describe("plugin lifecycle", () => {
  let configDir: string;

  beforeEach(async () => {
    resetPluginAdmissionForTests();
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u4-"));
  });

  afterEach(async () => {
    resetPluginAdmissionForTests();
    await rm(configDir, { force: true, recursive: true });
  });

  test("AE2: same package writes different database rows and files per org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());

    const orgA = await added(service, "org_a", "notes");
    const orgB = await added(service, "org_b", "notes");
    await service.enableOrgPlugin("org_a", "notes", orgA.revision);
    await service.enableOrgPlugin("org_b", "notes", orgB.revision);

    await service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor,
      input: { body: "alpha", id: "n1" },
      orgId: "org_a",
      pluginId: "notes",
    });
    const fromB = await service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor,
      input: { body: "beta", id: "n1" },
      orgId: "org_b",
      pluginId: "notes",
    });

    const resultB = fromB.result as { dataDir: string; rows: unknown[] };
    expect(resultB.rows).toEqual([{ body: "beta", id: "n1" }]);
    expect(resultB.dataDir).toBe(
      getOrgPluginDataDir("org_b", "notes", configDir)
    );

    const dbA = new Database(
      getOrgPluginDatabasePath(
        "org_a",
        "notes",
        (await db.getOrgPlugin("org_a", "notes"))?.databaseGeneration ?? "",
        configDir
      )
    );
    expect(dbA.query("SELECT id, body FROM items").all()).toEqual([
      { body: "alpha", id: "n1" },
    ]);
    dbA.close();
    expect(existsSync(join(resultB.dataDir, "n1.txt"))).toBe(true);
    expect(
      existsSync(
        join(getOrgPluginDataDir("org_a", "notes", configDir), "n1.txt")
      )
    ).toBe(true);
  });

  test("AE4: failed later migration discards the generation and keeps the old pair", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    const addedRow = await added(service, "org_a", "notes");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );
    const disabled = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabled.revision
    );
    await service.installPluginPackage(
      v2Bundle({ extraAction: true, failSecondMigration: true })
    );
    const selectedBefore = disabled.selectedVersion;
    const generationBefore = disabled.databaseGeneration;

    await expect(
      service.updateOrgPlugin("org_a", "notes", "1.1.0", disabled.revision)
    ).rejects.toBeInstanceOf(PluginHostError);

    const install = await db.getOrgPlugin("org_a", "notes");
    expect(install).toMatchObject({
      databaseGeneration: generationBefore,
      lifecycleState: "disabled",
      selectedVersion: selectedBefore,
    });
    const tools = (await db.listTools()).filter(
      (tool) => tool.orgId === "org_a" && tool.pluginId === "notes"
    );
    expect(tools.map((tool) => tool.pluginKey).sort()).toEqual(["write"]);
    const gens = await readdir(
      join(getOrgPluginDataDir("org_a", "notes", configDir), "db")
    );
    expect(gens).toEqual([`${generationBefore}.sqlite`]);
  });

  test("recover before host publication keeps the old pair and removes the orphan", async () => {
    const db = createInMemoryDatabaseAdapter();
    let interrupted = false;
    let armInterrupt = false;
    const service = new PluginService(db, configDir);
    setPluginLifecycleTestHooks({
      afterMigrationBeforePublish: async () => {
        if (!armInterrupt) {
          return;
        }
        interrupted = true;
        throw new PluginHostError("interrupted");
      },
    });
    await service.installPluginPackage(v1Bundle());
    const addedRow = await added(service, "org_a", "notes");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );
    const disabled = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabled.revision
    );
    await service.installPluginPackage(v2Bundle({ extraAction: true }));
    armInterrupt = true;
    await expect(
      service.updateOrgPlugin("org_a", "notes", "1.1.0", disabled.revision)
    ).rejects.toMatchObject({ code: "interrupted" });
    expect(interrupted).toBe(true);
    setPluginLifecycleTestHooks(null);

    const mid = await db.getOrgPlugin("org_a", "notes");
    expect(mid?.lifecycleState).toBe("updating");
    expect(mid?.selectedVersion).toBe("1.0.0");

    const recovered = new PluginService(db, configDir);
    await recovered.recoverInterruptedPluginOperations();
    const after = await db.getOrgPlugin("org_a", "notes");
    expect(after).toMatchObject({
      databaseGeneration: disabled.databaseGeneration,
      lifecycleState: "disabled",
      selectedVersion: "1.0.0",
    });
    const gens = await readdir(
      join(getOrgPluginDataDir("org_a", "notes", configDir), "db")
    );
    expect(gens).toEqual([`${disabled.databaseGeneration}.sqlite`]);
  });

  test("after publication, code-only update, and missing bytes recover without enabling incompatible code", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    setPluginLifecycleTestHooks({
      afterPublishBeforeFinalize: async () => {
        throw new PluginHostError("interrupted");
      },
    });
    await service.installPluginPackage(v1Bundle());
    const addedRow = await added(service, "org_a", "notes");
    await expect(
      service.enableOrgPlugin("org_a", "notes", addedRow.revision)
    ).rejects.toMatchObject({ code: "interrupted" });
    setPluginLifecycleTestHooks(null);
    const published = await db.getOrgPlugin("org_a", "notes");
    expect(published?.lifecycleState).toBe("enabling");
    expect(published?.databaseGeneration).toBeTruthy();

    const recovered = new PluginService(db, configDir);
    await recovered.recoverInterruptedPluginOperations();
    const afterPublish = await db.getOrgPlugin("org_a", "notes");
    expect(afterPublish).toMatchObject({
      databaseGeneration: published?.databaseGeneration,
      lifecycleState: "disabled",
      selectedVersion: "1.0.0",
    });

    const disabled = afterPublish!;
    await service.installPluginPackage(codeOnlyBundle());
    const updated = await new PluginService(db, configDir).updateOrgPlugin(
      "org_a",
      "notes",
      "1.0.1",
      disabled.revision
    );
    expect(updated.databaseGeneration).toBe(disabled.databaseGeneration);
    expect(updated.selectedVersion).toBe("1.0.1");
    expect(updated.lifecycleState).toBe("disabled");

    await rm(
      getOrgPluginDatabasePath(
        "org_a",
        "notes",
        updated.databaseGeneration ?? "",
        configDir
      )
    );
    await recovered.recoverInterruptedPluginOperations();
    const missing = await db.getOrgPlugin("org_a", "notes");
    expect(missing?.lifecycleState).toBe("disabled");
    expect(missing?.lastLifecycleError).toBeTruthy();
    await expect(
      recovered.invokePluginAction({
        access: "ui",
        actionKey: "write",
        actor,
        input: { body: "x", id: "n1" },
        orgId: "org_a",
        pluginId: "notes",
      })
    ).rejects.toMatchObject({ code: "admission_closed" });
  });

  test("AE5: uninstall retains data; purge needs matching revision and leaves neighbors", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    const orgA = await added(service, "org_a", "notes");
    const orgB = await added(service, "org_b", "notes");
    const enabledA = await service.enableOrgPlugin(
      "org_a",
      "notes",
      orgA.revision
    );
    const enabledB = await service.enableOrgPlugin(
      "org_b",
      "notes",
      orgB.revision
    );
    await service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor,
      input: { body: "keep-me", id: "n1" },
      orgId: "org_a",
      pluginId: "notes",
    });
    const disabledA = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabledA.revision
    );
    const retained = await service.uninstallOrgPlugin(
      "org_a",
      "notes",
      disabledA.revision
    );
    expect(retained.lifecycleState).toBe("retained");
    expect(
      existsSync(
        getOrgPluginDatabasePath(
          "org_a",
          "notes",
          retained.databaseGeneration ?? "",
          configDir
        )
      )
    ).toBe(true);

    await expect(
      service.addOrgPlugin("org_a", "notes", "1.0.0")
    ).resolves.toMatchObject({
      lifecycleState: "disabled",
    });
    const reinstalled = await db.getOrgPlugin("org_a", "notes");
    const dbA = new Database(
      getOrgPluginDatabasePath(
        "org_a",
        "notes",
        reinstalled?.databaseGeneration ?? "",
        configDir
      )
    );
    expect(dbA.query("SELECT body FROM items").all()).toEqual([
      { body: "keep-me" },
    ]);
    dbA.close();

    const stalePurge = service.deleteRetainedPluginData(
      "org_a",
      "notes",
      (reinstalled?.revision ?? 0) + 9
    );
    await expect(stalePurge).rejects.toBeInstanceOf(PluginHostError);
    expect(await db.getOrgPlugin("org_a", "notes")).not.toBeNull();

    const disabledAgain = await service.uninstallOrgPlugin(
      "org_a",
      "notes",
      reinstalled?.revision ?? 0
    );
    await service.deleteRetainedPluginData(
      "org_a",
      "notes",
      disabledAgain.revision
    );
    expect(await db.getOrgPlugin("org_a", "notes")).toBeNull();
    expect(existsSync(getOrgPluginDataDir("org_a", "notes", configDir))).toBe(
      false
    );
    expect(await db.getOrgPlugin("org_b", "notes")).toMatchObject({
      lifecycleState: "enabled",
      revision: enabledB.revision,
    });
    expect(existsSync(getOrgPluginDataDir("org_b", "notes", configDir))).toBe(
      true
    );
  });

  test("enable/disable/update race: only the winner mutates and disable closes admission", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(hangActionBundle());
    await service.installPluginPackage(v2Bundle({ extraAction: true }));
    const addedRow = await added(service, "org_a", "notes", "1.0.0");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );

    const hanging = service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor,
      input: { body: "x", id: "n1" },
      orgId: "org_a",
      pluginId: "notes",
    });
    hanging.catch(() => undefined);
    await Bun.sleep(30);

    const results = await Promise.allSettled([
      service.enableOrgPlugin("org_a", "notes", enabled.revision),
      service.disableOrgPlugin("org_a", "notes", enabled.revision),
      service.updateOrgPlugin("org_a", "notes", "1.1.0", enabled.revision),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const winner = fulfilled[0] as PromiseFulfilledResult<{
      lifecycleState: string;
    }>;
    expect(winner.value.lifecycleState).toBe("disabled");

    await expect(hanging).rejects.toBeInstanceOf(Error);
    await expect(
      service.invokePluginAction({
        access: "ui",
        actionKey: "write",
        actor,
        input: { body: "x", id: "n2" },
        orgId: "org_a",
        pluginId: "notes",
      })
    ).rejects.toBeInstanceOf(PluginHostError);

    const tools = (await db.listTools()).filter(
      (tool) => tool.orgId === "org_a" && tool.pluginId === "notes"
    );
    expect(tools.map((tool) => tool.pluginKey).sort()).toEqual(["write"]);
  });

  test("committed intermediate migration is discarded with the private generation", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    const addedRow = await added(service, "org_a", "notes");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );
    const disabled = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabled.revision
    );
    await service.installPluginPackage(commitThenFailBundle());

    await expect(
      service.updateOrgPlugin("org_a", "notes", "1.2.0", disabled.revision)
    ).rejects.toBeInstanceOf(PluginHostError);

    const install = await db.getOrgPlugin("org_a", "notes");
    const selected = new Database(
      getOrgPluginDatabasePath(
        "org_a",
        "notes",
        install?.databaseGeneration ?? "",
        configDir
      )
    );
    expect(
      selected
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'leaked'"
        )
        .get()
    ).toBeNull();
    expect(selected.query("SELECT COUNT(*) AS n FROM items").get()).toEqual({
      n: 0,
    });
    selected.close();
    expect(install).toMatchObject({
      lifecycleState: "disabled",
      selectedVersion: "1.0.0",
    });
  });

  test("first enable publishes owned contributions; disable keeps assignments; update replaces keys", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    const addedRow = await added(service, "org_a", "notes");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );
    const tools = (await db.listTools()).filter(
      (tool) => tool.orgId === "org_a" && tool.pluginId === "notes"
    );
    const skills = (await db.listSkills()).filter(
      (skill) => skill.orgId === "org_a" && skill.pluginId === "notes"
    );
    expect(tools.map((tool) => tool.name)).toEqual(["plugin_notes__write"]);
    expect(skills.map((skill) => skill.pluginKey)).toEqual(["notes"]);
    const toolId = tools[0]?.id;
    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_1",
      isSuper: false,
      model: null,
      name: "P",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: new Date().toISOString(),
    });
    if (toolId) {
      await db.assignToolToProfile("profile_1", toolId);
    }

    const disabled = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabled.revision
    );
    expect(await db.listToolsForProfile("profile_1")).toHaveLength(1);

    await service.installPluginPackage(v2Bundle({ extraAction: true }));
    const updated = await service.updateOrgPlugin(
      "org_a",
      "notes",
      "1.1.0",
      disabled.revision
    );
    const afterTools = (await db.listTools()).filter(
      (tool) => tool.orgId === "org_a" && tool.pluginId === "notes"
    );
    expect(afterTools.map((tool) => tool.pluginKey).sort()).toEqual([
      "extra",
      "write",
    ]);
    expect(afterTools.find((tool) => tool.pluginKey === "write")?.id).toBe(
      toolId
    );
    expect(updated.lifecycleState).toBe("disabled");
    expect(await db.listToolsForProfile("profile_1")).toHaveLength(1);
  });

  test("purging retained data blocks reinstall until cleanup finishes", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    const installed = await added(service, "org_a", "notes");
    const retained = await service.uninstallOrgPlugin(
      "org_a",
      "notes",
      installed.revision
    );
    const deleted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const deleteOrgPlugin = db.deleteOrgPlugin.bind(db);
    db.deleteOrgPlugin = async (...args) => {
      const result = await deleteOrgPlugin(...args);
      deleted.resolve();
      await resume.promise;
      return result;
    };

    const purging = service.deleteRetainedPluginData(
      "org_a",
      "notes",
      retained.revision
    );
    await deleted.promise;
    const reinstalling = new PluginService(db, configDir).addOrgPlugin(
      "org_a",
      "notes"
    );
    try {
      // Other organizations can install while org_a's cleanup is paused.
      await added(service, "org_b", "notes");
      expect(await db.getOrgPlugin("org_a", "notes")).toBeNull();
    } finally {
      resume.resolve();
      await Promise.all([purging, reinstalling]);
    }

    const fresh = await reinstalling;
    await service.enableOrgPlugin("org_a", "notes", fresh.revision);
    const written = await service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor,
      input: { body: "after reinstall", id: "new" },
      orgId: "org_a",
      pluginId: "notes",
    });
    expect(written.result).toMatchObject({
      rows: [{ body: "after reinstall", id: "new" }],
    });
  });

  test("reinstall from retained rejects a schema downgrade", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(v1Bundle());
    await service.installPluginPackage(v2Bundle({ extraAction: true }));
    const addedRow = await added(service, "org_a", "notes", "1.1.0");
    const enabled = await service.enableOrgPlugin(
      "org_a",
      "notes",
      addedRow.revision
    );
    const disabled = await service.disableOrgPlugin(
      "org_a",
      "notes",
      enabled.revision
    );
    await service.uninstallOrgPlugin("org_a", "notes", disabled.revision);

    await expect(
      service.addOrgPlugin("org_a", "notes", "1.0.0")
    ).rejects.toMatchObject({ code: "incompatible" });
  });
  test("plugin workers run bundled code per org and stop before disable completes", async () => {
    const db = createInMemoryDatabaseAdapter();
    const processes = new Map<string, ReturnType<typeof Bun.spawn>>();
    const pm2 = {
      connect: (cb: (error: Error | null, value?: unknown) => void) => cb(null),
      delete: (
        name: string,
        cb: (error: Error | null, value?: unknown) => void
      ) => {
        const child = processes.get(name);
        if (!child) {
          cb(null);
          return;
        }
        child.kill();
        void child.exited.then(() => {
          processes.delete(name);
          cb(null);
        });
      },
      describe: (
        name: string,
        cb: (error: Error | null, value?: unknown) => void
      ) => cb(null, processes.has(name) ? [{ name }] : []),
      disconnect() {},
      list: (cb: (error: Error | null, value?: unknown) => void) =>
        cb(
          null,
          [...processes].map(([name]) => ({
            name,
            pm2_env: { status: "online" },
          }))
        ),
      start: (
        options: {
          name: string;
          script: string;
          args: string[];
          cwd: string;
          env: Record<string, string>;
        },
        cb: (error: Error | null, value?: unknown) => void
      ) => {
        const child = Bun.spawn([options.script, ...options.args], {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stderr: "ignore",
          stdout: "ignore",
        });
        processes.set(options.name, child);
        cb(null);
      },
      stop: (
        name: string,
        cb: (error: Error | null, value?: unknown) => void
      ) => {
        const child = processes.get(name);
        if (!child) {
          cb(null);
          return;
        }
        child.kill();
        void child.exited.then(() => cb(null));
      },
    } as unknown as typeof import("pm2");
    const workerManager = new WorkerManagerService(configDir, pm2);
    const service = new PluginService(db, configDir, { workerManager });
    const source = pluginPackage({
      "nakama.plugin.json": JSON.stringify(
        baseManifest("notes", "1.0.0", {
          actions: [],
          database: undefined,
          skills: [],
          workers: [{ entry: "worker.js", key: "index", name: "Indexer" }],
        })
      ),
      "worker.js": `await Bun.write(process.env.NAKAMA_PLUGIN_DATA_DIR + "/started", process.env.NAKAMA_ORG_ID); setInterval(() => {}, 1000);`,
    });
    try {
      await service.installPluginPackage(source);
      const a = await added(service, "org-a", "notes");
      const b = await added(service, "org-b", "notes");
      const enabled = await service.enableOrgPlugin(
        "org-a",
        "notes",
        a.revision
      );
      await service.enableOrgPlugin("org-b", "notes", b.revision);
      const marker = join(
        getOrgPluginDataDir("org-a", "notes", configDir),
        "started"
      );
      for (let i = 0; i < 100 && !existsSync(marker); i++) {
        await Bun.sleep(10);
      }
      expect(await Bun.file(marker).text()).toBe("org-a");
      expect(processes.size).toBe(2);
      await runWithPluginExportBarrier(async () => {
        expect(
          await Promise.race([
            Promise.all(
              [...processes.values()].map((child) => child.exited)
            ).then(() => true),
            Bun.sleep(100).then(() => false),
          ])
        ).toBe(true);
        const [worker] = await workerManager.listPluginWorkers("org-a");
        await expect(workerManager.startWorker(worker!.name)).rejects.toThrow();
      });
      expect(
        [...processes.values()].every((child) => child.exitCode === null)
      ).toBe(true);
      await service.disableOrgPlugin("org-a", "notes", enabled.revision);
      expect(processes.size).toBe(1);
      expect(await workerManager.listPluginWorkers("org-a")).toEqual([]);
      expect(await Bun.file(marker).text()).toBe("org-a");
      expect((await db.getOrgPlugin("org-a", "notes"))?.lifecycleState).toBe(
        "disabled"
      );
    } finally {
      await workerManager.unregisterPluginWorkers("org-a", "notes");
      await workerManager.unregisterPluginWorkers("org-b", "notes");
      for (const child of processes.values()) {
        child.kill();
      }
    }
  });

  test("a worker start failure leaves the plugin disabled and retryable", async () => {
    const db = createInMemoryDatabaseAdapter();
    let fail = true;
    const service = new PluginService(db, configDir, {
      workerManager: {
        registerPluginWorkers: async () => {
          if (fail) {
            throw new Error("Could not start worker");
          }
        },
        unregisterPluginWorkers: async () => {},
      },
    });
    const source = pluginPackage({
      "nakama.plugin.json": JSON.stringify(
        baseManifest("notes", "1.0.0", {
          actions: [],
          database: undefined,
          skills: [],
          workers: [{ entry: "worker.js", key: "index", name: "Indexer" }],
        })
      ),
      "worker.js": "setInterval(() => {}, 1000)",
    });
    await service.installPluginPackage(source);
    const install = await added(service, "org-a", "notes");
    await expect(
      service.enableOrgPlugin("org-a", "notes", install.revision)
    ).rejects.toThrow();
    const failed = (await db.getOrgPlugin("org-a", "notes"))!;
    expect(failed.lifecycleState).toBe("disabled");
    fail = false;
    expect(
      (await service.enableOrgPlugin("org-a", "notes", failed.revision))
        .lifecycleState
    ).toBe("enabled");
  });
});
