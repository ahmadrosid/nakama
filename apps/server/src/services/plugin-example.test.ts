import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getOrgPluginDatabasePath,
  PLUGIN_MANIFEST_API_VERSION,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
} from "@nakama/db";
import { zipSync } from "fflate";
import { PluginService, resetPluginAdmissionForTests } from "./plugin-service";

const NOTES_DIR = fileURLToPath(
  new URL("../../../../examples/plugins/notes", import.meta.url)
);
const NOTES_V2_DIR = fileURLToPath(
  new URL("../../../../examples/plugins/notes-v2", import.meta.url)
);

const ACTOR = { id: "admin_1", role: "admin" as const };
const ORG_A = "org_a";
const ORG_B = "org_b";

const SKIP_ZIP_DIRS = new Set(["node_modules", "ui-src"]);

async function zipPluginDir(dir: string): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};

  async function walk(current: string, relative: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (SKIP_ZIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const nextRel = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, nextRel);
      } else if (entry.isFile()) {
        entries[nextRel] = await readFile(absolute);
      }
    }
  }

  await walk(dir, "");
  return zipSync(entries);
}

async function enableNotes(service: PluginService, orgId: string) {
  const added = await service.addOrgPlugin(orgId, "notes");
  return service.enableOrgPlugin(orgId, "notes", added.revision, ACTOR);
}

describe("Notes plugin example", () => {
  let configDir = "";

  beforeEach(async () => {
    resetPluginAdmissionForTests();
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u8-example-"));
  });

  afterEach(async () => {
    resetPluginAdmissionForTests();
    await rm(configDir, { force: true, recursive: true });
  });

  test("AE1/AE2: packaged Notes shares UI and tool data only within an org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const archive = await zipPluginDir(NOTES_DIR);

    const preview = await service.previewPluginPackage(archive);
    expect(preview.manifest.id).toBe("notes");
    expect(preview.manifest.apiVersion).toBe(PLUGIN_MANIFEST_API_VERSION);
    expect(preview.contributions.skillKeys).toEqual(["notes"]);
    expect(preview.contributions.actionKeys).toEqual(["list", "create"]);
    expect(preview.contributions.hasUi).toBe(true);
    expect(preview.contributions.hasDatabase).toBe(true);

    await service.installPluginPackage(archive);
    await enableNotes(service, ORG_A);
    await enableNotes(service, ORG_B);

    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_a",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "A",
      orgId: ORG_A,
      systemPrompt: "",
      updatedAt: new Date().toISOString(),
    });
    const listTool = (await db.listTools()).find(
      (tool) =>
        tool.orgId === ORG_A &&
        tool.pluginId === "notes" &&
        tool.pluginKey === "list"
    );
    expect(listTool?.name).toBe("plugin_notes__list");
    await db.assignToolToProfile("profile_a", listTool!.id);

    const created = await service.invokePluginAction({
      access: "ui",
      actionKey: "create",
      actor: ACTOR,
      input: { body: "from page", title: "Alpha" },
      orgId: ORG_A,
      pluginId: "notes",
    });
    expect(created.result).toMatchObject({ title: "Alpha" });

    const listed = await service.invokePluginAction({
      access: "tool",
      actionKey: "list",
      actor: ACTOR,
      input: {},
      orgId: ORG_A,
      pluginId: "notes",
      profileId: "profile_a",
    });
    expect(listed.result).toMatchObject({
      notes: [expect.objectContaining({ body: "from page", title: "Alpha" })],
    });

    const fromB = await service.invokePluginAction({
      access: "ui",
      actionKey: "list",
      actor: ACTOR,
      input: {},
      orgId: ORG_B,
      pluginId: "notes",
    });
    expect(fromB.result).toEqual({ notes: [] });

    const html = await readFile(join(NOTES_DIR, "ui/index.html"), "utf8");
    const app = await readFile(join(NOTES_DIR, "ui/assets/app.js"), "utf8");
    expect(html).toContain("./assets/app.js");
    expect(app).toContain("nakama-plugin-ready");
    expect(app).toContain("__nakama/bootstrap.json");
    expect(app).toContain('pluginId: "notes"');
  });

  test("upgrade keeps old notes readable with the new pinned field", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    await service.installPluginPackage(await zipPluginDir(NOTES_DIR));
    const enabled = await enableNotes(service, ORG_A);
    await service.invokePluginAction({
      access: "ui",
      actionKey: "create",
      actor: ACTOR,
      input: { body: "keep me", title: "Old" },
      orgId: ORG_A,
      pluginId: "notes",
    });

    const disabled = await service.disableOrgPlugin(
      ORG_A,
      "notes",
      enabled.revision,
      ACTOR
    );
    await service.installPluginPackage(await zipPluginDir(NOTES_V2_DIR));
    await service.updateOrgPlugin(
      ORG_A,
      "notes",
      "1.1.0",
      disabled.revision,
      ACTOR
    );
    const updated = await db.getOrgPlugin(ORG_A, "notes");
    const reenabled = await service.enableOrgPlugin(
      ORG_A,
      "notes",
      updated!.revision,
      ACTOR
    );

    const listed = await service.invokePluginAction({
      access: "ui",
      actionKey: "list",
      actor: ACTOR,
      input: {},
      orgId: ORG_A,
      pluginId: "notes",
    });
    expect(listed.result).toMatchObject({
      notes: [expect.objectContaining({ pinned: 0, title: "Old" })],
    });

    const pluginDb = new Database(
      getOrgPluginDatabasePath(
        ORG_A,
        "notes",
        reenabled.databaseGeneration ?? "",
        configDir
      )
    );
    expect(pluginDb.query("SELECT title, pinned FROM notes").all()).toEqual([
      { pinned: 0, title: "Old" },
    ]);
    pluginDb.close();
  });

  test("volume-backed restart keeps Notes data without the repo CWD", async () => {
    const databasePath = join(configDir, "nakama.db");
    const database = await createSqliteDatabase(`file:${databasePath}`);
    await database.adapter.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
      updatedAt: new Date().toISOString(),
    });
    const first = new PluginService(database.adapter, configDir);
    await first.installPluginPackage(await zipPluginDir(NOTES_DIR));
    await enableNotes(first, ORG_A);
    await first.invokePluginAction({
      access: "ui",
      actionKey: "create",
      actor: ACTOR,
      input: { body: "persisted", title: "Restart" },
      orgId: ORG_A,
      pluginId: "notes",
    });
    await database.close();

    const reopened = await createSqliteDatabase(`file:${databasePath}`);
    const second = new PluginService(reopened.adapter, configDir);
    const listed = await second.invokePluginAction({
      access: "ui",
      actionKey: "list",
      actor: ACTOR,
      input: {},
      orgId: ORG_A,
      pluginId: "notes",
    });
    expect(listed.result).toMatchObject({
      notes: [expect.objectContaining({ title: "Restart" })],
    });
    await reopened.close();
  });
});
