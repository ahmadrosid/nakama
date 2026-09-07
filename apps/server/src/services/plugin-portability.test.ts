import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCustomToolsDir,
  getOrgPluginDatabasePath,
  pathExists,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
} from "@nakama/db";
import { unzipSync, zipSync } from "fflate";
import {
  createNakamaDataExport,
  restoreNakamaDataImport,
} from "./data-portability";
import {
  PluginService,
  quarantineInvalidPluginReleases,
  resetPluginAdmissionForTests,
  runWithPluginExportBarrier,
  setPluginLifecycleTestHooks,
} from "./plugin-service";
import {
  createProfilePackExport,
  importProfilePack,
  previewProfilePackImport,
} from "./profile-portability";

const ACTOR = { id: "admin_1", role: "admin" as const };
const ORG = "org_src";
const DEST = "org_dest";

function notesBundle(): Uint8Array {
  return zipSync({
    "actions/create.js": Buffer.from(
      "export function run(input) { return input; }"
    ),
    "actions/list.js": Buffer.from(
      "export function run() { return { notes: [] }; }"
    ),
    "migrations/001.sql": Buffer.from("CREATE TABLE notes (title TEXT);"),
    "nakama.plugin.json": Buffer.from(
      JSON.stringify({
        actions: ["list", "create"].map((key) => ({
          access: "member",
          description: key,
          effect: key === "list" ? "read" : "write",
          entry: `actions/${key}.js`,
          exposeAsTool: true,
          inputSchema: { type: "object" },
          key,
        })),
        apiVersion: 1,
        author: "Nakama",
        database: { migrations: [{ id: "001", path: "migrations/001.sql" }] },
        description: "Portability test fixture",
        id: "notes",
        license: "MIT",
        minNakamaVersion: "0.1.0",
        name: "Notes",
        skills: [{ directory: "skills/notes", key: "notes" }],
        version: "1.0.0",
      })
    ),
    "skills/notes/SKILL.md": Buffer.from(
      "---\nname: notes\ndescription: Test plugin skill\n---\nList notes.\n"
    ),
  });
}

function hangBundle(): Uint8Array {
  return zipSync({
    "actions/hang.js": Buffer.from(`
export async function run() {
  await new Promise(() => {});
}
`),
    "migrations/001.sql": Buffer.from("CREATE TABLE items (id TEXT);\n"),
    "nakama.plugin.json": Buffer.from(
      JSON.stringify({
        actions: [
          {
            access: "member",
            description: "Hang",
            effect: "write",
            entry: "actions/hang.js",
            exposeAsTool: true,
            inputSchema: { type: "object" },
            key: "hang",
          },
        ],
        apiVersion: 1,
        author: "Nakama",
        database: {
          migrations: [{ id: "001", path: "migrations/001.sql" }],
        },
        description: "Hang",
        id: "hang",
        license: "MIT",
        minNakamaVersion: "0.1.0",
        name: "Hang",
        skills: [],
        version: "1.0.0",
      })
    ),
  });
}

function slowWriteBundle(): Uint8Array {
  return zipSync({
    "actions/write.js": Buffer.from(`
import { Database } from "bun:sqlite";
export async function run(input, context) {
  const db = new Database(context.databasePath);
  db.run("INSERT INTO items (id, body) VALUES (?, ?)", [input.id, input.body]);
  db.close();
  await Bun.sleep(200);
  return { ok: true };
}
`),
    "migrations/001.sql": Buffer.from(
      "CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);\n"
    ),
    "nakama.plugin.json": Buffer.from(
      JSON.stringify({
        actions: [
          {
            access: "member",
            description: "Write",
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
        apiVersion: 1,
        author: "Nakama",
        database: {
          migrations: [{ id: "001", path: "migrations/001.sql" }],
        },
        description: "Slow write",
        id: "slow",
        license: "MIT",
        minNakamaVersion: "0.1.0",
        name: "Slow",
        skills: [],
        version: "1.0.0",
      })
    ),
  });
}

describe("plugin portability", () => {
  let configDir = "";
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

  beforeEach(async () => {
    resetPluginAdmissionForTests();
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u8-port-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    resetPluginAdmissionForTests();
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
    await rm(configDir, { force: true, recursive: true });
  });

  test("export during a plugin write snapshots consistently and restore leaves plugins disabled", async () => {
    const databasePath = join(configDir, "nakama.db");
    const database = await createSqliteDatabase(`file:${databasePath}`);
    await database.adapter.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG,
      name: "Source",
      slug: "source",
      updatedAt: new Date().toISOString(),
    });
    const service = new PluginService(database.adapter, configDir);
    await service.installPluginPackage(slowWriteBundle());
    const added = await service.addOrgPlugin(ORG, "slow");
    await service.enableOrgPlugin(ORG, "slow", added.revision);

    const write = service.invokePluginAction({
      access: "ui",
      actionKey: "write",
      actor: ACTOR,
      input: { body: "kept", id: "n1" },
      orgId: ORG,
      pluginId: "slow",
    });
    await Bun.sleep(40);
    const exported = await createNakamaDataExport({
      drainTimeoutMs: 2000,
      rootDir: configDir,
    });
    await write;

    const restoreRoot = await mkdtemp(join(tmpdir(), "nakama-plugin-restore-"));
    try {
      await restoreNakamaDataImport(exported.data, {
        confirm: true,
        databasePath: join(restoreRoot, "nakama.db"),
        rootDir: restoreRoot,
      });

      const restoredDb = new Database(join(restoreRoot, "nakama.db"));
      const install = restoredDb
        .query(
          `SELECT o.lifecycle_state AS lifecycle_state, r.digest AS digest
           FROM org_plugins o
           JOIN plugin_releases r
             ON r.plugin_id = o.plugin_id AND r.version = o.selected_version
           WHERE o.plugin_id = 'slow'`
        )
        .get() as { digest: string; lifecycle_state: string };
      expect(install.lifecycle_state).toBe("disabled");
      expect(install.digest.length).toBe(64);
      restoredDb.close();

      const restoredAdapter = await createSqliteDatabase(
        `file:${join(restoreRoot, "nakama.db")}`
      );
      const restoredService = new PluginService(
        restoredAdapter.adapter,
        restoreRoot
      );
      const row = await restoredAdapter.adapter.getOrgPlugin(ORG, "slow");
      expect(row?.lifecycleState).toBe("disabled");
      const enabled = await restoredService.enableOrgPlugin(
        ORG,
        "slow",
        row!.revision
      );
      const snapshot = new Database(
        getOrgPluginDatabasePath(
          ORG,
          "slow",
          enabled.databaseGeneration ?? "",
          restoreRoot
        )
      );
      expect(snapshot.query("SELECT id, body FROM items").all()).toEqual([
        { body: "kept", id: "n1" },
      ]);
      snapshot.close();
      await restoredAdapter.close();
    } finally {
      await rm(restoreRoot, { force: true, recursive: true });
    }

    await database.close();
  });

  test.each(["explicit", "configured"])(
    "export snapshots %s main database WAL rows and preserves unrelated sidecars",
    async (pathSource) => {
      const databasePath = join(configDir, "nakama.db");
      const previousDatabaseUrl = process.env.DATABASE_URL;
      if (pathSource === "configured") {
        process.env.DATABASE_URL = `file:${databasePath}`;
      }
      const live = new Database(databasePath);
      const otherPath = join(configDir, "other.db");
      const other = new Database(otherPath);
      const restoreRoot = await mkdtemp(join(tmpdir(), "nakama-wal-restore-"));
      try {
        for (const db of [live, other]) {
          db.exec(`
          PRAGMA journal_mode=WAL;
          CREATE TABLE notes (body TEXT);
          PRAGMA wal_checkpoint(TRUNCATE);
          INSERT INTO notes VALUES ('committed');
        `);
        }
        const exported = await createNakamaDataExport({
          ...(pathSource === "explicit" ? { databasePath } : {}),
          rootDir: configDir,
        });
        const entries = unzipSync(exported.data);
        expect(entries["nakama.db-wal"]).toBeUndefined();
        expect(entries["other.db-wal"]).toBeDefined();
        await restoreNakamaDataImport(exported.data, {
          confirm: true,
          rootDir: restoreRoot,
        });
        for (const name of ["nakama.db", "other.db"]) {
          const restored = new Database(join(restoreRoot, name));
          try {
            expect(restored.query("SELECT body FROM notes").all()).toEqual([
              { body: "committed" },
            ]);
          } finally {
            restored.close();
          }
        }
      } finally {
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
        live.close();
        other.close();
        await rm(restoreRoot, { force: true, recursive: true });
      }
    }
  );

  test("export blocks lifecycle mutations, new calls, and overlapping exports", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );
    const archive = notesBundle();
    await service.installPluginPackage(archive);
    const added = await service.addOrgPlugin(ORG, "notes");
    const enabled = await service.enableOrgPlugin(ORG, "notes", added.revision);
    const disabled = await service.disableOrgPlugin(
      ORG,
      "notes",
      enabled.revision
    );

    await runWithPluginExportBarrier(async () => {
      const mutations = [
        () => service.installPluginPackage(archive),
        () => service.addOrgPlugin(DEST, "notes"),
        () => service.enableOrgPlugin(ORG, "notes", disabled.revision),
        () => service.disableOrgPlugin(ORG, "notes", disabled.revision),
        () => service.updateOrgPlugin(ORG, "notes", "1.0.0", disabled.revision),
        () => service.uninstallOrgPlugin(ORG, "notes", disabled.revision),
        () => service.deleteRetainedPluginData(ORG, "notes", disabled.revision),
        () => service.removePluginRelease("notes", "1.0.0"),
      ];
      for (const mutate of mutations) {
        await expect(mutate()).rejects.toMatchObject({ code: "in_use" });
      }
      await expect(
        runWithPluginExportBarrier(async () => undefined)
      ).rejects.toThrow();
      // A rejected overlapping export must not clear the first export's lock.
      await expect(mutations[2]!()).rejects.toMatchObject({ code: "in_use" });
    });

    await service.enableOrgPlugin(ORG, "notes", disabled.revision);
    const invoke = () =>
      service.invokePluginAction({
        access: "ui",
        actionKey: "create",
        actor: ACTOR,
        input: { title: "after export" },
        orgId: ORG,
        pluginId: "notes",
      });
    await expect(
      runWithPluginExportBarrier(async () => {
        await expect(invoke()).rejects.toMatchObject({
          code: "admission_closed",
        });
        throw new Error("export failed");
      })
    ).rejects.toThrow("export failed");
    expect((await invoke()).result).toMatchObject({ title: "after export" });
  });

  test("export waits for an admitted lifecycle mutation to publish", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );
    await service.installPluginPackage(notesBundle());
    const added = await service.addOrgPlugin(ORG, "notes");
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    setPluginLifecycleTestHooks({
      afterMigrationBeforePublish: async () => {
        reached.resolve();
        await resume.promise;
      },
    });
    const enable = service.enableOrgPlugin(ORG, "notes", added.revision);
    await reached.promise;
    let snapshotStarted = false;
    const exported = runWithPluginExportBarrier(async () => {
      snapshotStarted = true;
      expect(
        (await service.getOrgPluginDetail(ORG, "notes"))?.lifecycleState
      ).toBe("enabled");
    });
    try {
      await expect(service.addOrgPlugin(DEST, "notes")).rejects.toMatchObject({
        code: "in_use",
      });
      expect(snapshotStarted).toBe(false);
    } finally {
      resume.resolve();
      await enable;
      await exported;
      setPluginLifecycleTestHooks(null);
    }
    expect(snapshotStarted).toBe(true);
  });

  test("invalid restored package hashes stay unavailable", async () => {
    const databasePath = join(configDir, "nakama.db");
    const database = await createSqliteDatabase(`file:${databasePath}`);
    await database.adapter.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG,
      name: "Source",
      slug: "source",
      updatedAt: new Date().toISOString(),
    });
    const service = new PluginService(database.adapter, configDir);
    await service.installPluginPackage(notesBundle());
    await service.addOrgPlugin(ORG, "notes");
    const exported = await createNakamaDataExport({ rootDir: configDir });
    await database.close();

    const restoreRoot = await mkdtemp(join(tmpdir(), "nakama-plugin-badhash-"));
    try {
      await restoreNakamaDataImport(exported.data, {
        confirm: true,
        databasePath: join(restoreRoot, "nakama.db"),
        rootDir: restoreRoot,
      });
      await writeFile(
        join(restoreRoot, "plugins", "notes", "1.0.0", "actions", "list.js"),
        "export async function run() { return { notes: [] }; }\n"
      );
      await quarantineInvalidPluginReleases(restoreRoot);
      const restored = await createSqliteDatabase(
        `file:${join(restoreRoot, "nakama.db")}`
      );
      const restoredService = new PluginService(restored.adapter, restoreRoot);
      const row = await restored.adapter.getOrgPlugin(ORG, "notes");
      await expect(
        restoredService.enableOrgPlugin(ORG, "notes", row!.revision)
      ).rejects.toMatchObject({ code: "package_unavailable" });
      expect(
        await restored.adapter.getPluginRelease("notes", "1.0.0")
      ).toMatchObject({ digest: expect.any(String) });
      await restored.close();
    } finally {
      await rm(restoreRoot, { force: true, recursive: true });
    }
  });

  test("export fails and releases the barrier when a plugin write cannot drain", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir, { drainTimeoutMs: 80 });
    await service.installPluginPackage(hangBundle());
    const added = await service.addOrgPlugin(ORG, "hang");
    await service.enableOrgPlugin(ORG, "hang", added.revision);
    const hung = service.invokePluginAction({
      access: "ui",
      actionKey: "hang",
      actor: ACTOR,
      input: {},
      orgId: ORG,
      pluginId: "hang",
    });

    await Bun.sleep(30);
    await expect(
      createNakamaDataExport({ drainTimeoutMs: 80, rootDir: configDir })
    ).rejects.toMatchObject({ status: 503 });

    let rejected: unknown;
    const second = service
      .invokePluginAction({
        access: "ui",
        actionKey: "hang",
        actor: ACTOR,
        input: {},
        orgId: ORG,
        pluginId: "hang",
      })
      .catch((error) => {
        rejected = error;
      });
    await Bun.sleep(40);
    expect(rejected).toBeUndefined();

    hung.catch(() => undefined);
    second.catch(() => undefined);
  });

  test.each([false, true])(
    "profile packs omit plugin code and assignments (destination installed: %s)",
    async (installed) => {
      const db = createInMemoryDatabaseAdapter();
      const service = new PluginService(db, configDir);
      await service.installPluginPackage(notesBundle());
      const added = await service.addOrgPlugin(ORG, "notes");
      await service.enableOrgPlugin(ORG, "notes", added.revision);

      await db.upsertProfile({
        createdAt: new Date().toISOString(),
        id: "writer",
        isDefault: false,
        isSuper: false,
        model: null,
        name: "Writer",
        orgId: ORG,
        systemPrompt: "",
        updatedAt: new Date().toISOString(),
      });
      const skill = (await db.listSkills()).find(
        (row) => row.orgId === ORG && row.pluginId === "notes"
      );
      const tool = (await db.listTools()).find(
        (row) =>
          row.orgId === ORG &&
          row.pluginId === "notes" &&
          row.pluginKey === "list"
      );
      await db.assignSkillToProfile("writer", skill!.id);
      await db.assignToolToProfile("writer", tool!.id);

      const packed = await createProfilePackExport(db, ORG, "writer");
      expect(packed.manifest.meta.bundledSkillNames).toEqual([]);
      expect(packed.manifest.meta.profileSkillNames).toEqual([]);
      expect(packed.manifest.meta.toolNames).toEqual([]);
      expect(
        Object.keys(unzipSync(packed.data)).some(
          (path) =>
            path.startsWith("skills/") || path.startsWith("custom-tools/")
        )
      ).toBe(false);
      expect(
        packed.manifest.meta.customTools?.some((item) =>
          item.name.startsWith("plugin_notes__")
        )
      ).toBeFalsy();

      const dest = createInMemoryDatabaseAdapter();
      if (installed) {
        const destService = new PluginService(dest, configDir);
        await destService.installPluginPackage(notesBundle());
        const destAdded = await destService.addOrgPlugin(DEST, "notes");
        await destService.enableOrgPlugin(DEST, "notes", destAdded.revision);
      }
      const preview = await previewProfilePackImport(dest, DEST, packed.data);
      expect(preview.skippedAssignments).toEqual([]);

      const imported = await importProfilePack(dest, DEST, packed.data, {
        confirm: true,
        restoreCustomTools: true,
      });
      expect(imported.skippedAssignments).toEqual([]);
      expect(await dest.listToolsForProfile(imported.profileId)).toEqual([]);
      expect(await dest.listSkillsForProfile(imported.profileId)).toEqual([]);
      expect(
        await pathExists(join(getCustomToolsDir(), "plugin_notes__list.js"))
      ).toBe(false);
    }
  );
});
