import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { getPluginReleaseDir, PLUGIN_MANIFEST_API_VERSION } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { zipSync } from "fflate";
import { PluginHostError, PluginService } from "./plugin-service";

const SIDE_EFFECT_MARKER = join(tmpdir(), "nakama-plugin-side-effect-marker");

const identity = {
  author: "Nakama",
  description: "Notes for an organization",
  id: "notes",
  license: "MIT",
  name: "Notes",
  version: "1.0.0",
};

const sideEffectJs = `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(SIDE_EFFECT_MARKER)}, "ran");
throw new Error("plugin side-effect executed");
`;

function notesManifest(overrides: Record<string, unknown> = {}) {
  return {
    actions: [
      {
        access: "member",
        description: "List notes",
        effect: "read",
        entry: "actions/list.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "list",
      },
    ],
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    minNakamaVersion: "0.1.0",
    skills: [{ directory: "skills/notes", key: "notes" }],
    ui: {
      assetsDir: "ui/assets",
      entryHtml: "ui/index.html",
      pageLabel: "Notes",
    },
    ...identity,
    ...overrides,
  };
}

function encodeZip(
  files: Record<string, string | Uint8Array>,
  options?: Parameters<typeof zipSync>[1]
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = typeof value === "string" ? Buffer.from(value) : value;
  }
  return zipSync(entries, options);
}

function validBundle(overrides: Record<string, unknown> = {}): Uint8Array {
  const manifest = notesManifest(overrides);
  return encodeZip({
    "actions/list.js": sideEffectJs,
    "nakama.plugin.json": JSON.stringify(manifest),
    "side-effect.js": sideEffectJs,
    "skills/notes/SKILL.md": "# Notes\n",
    "ui/assets/app.js": "export {}",
    "ui/index.html": "<html></html>",
  });
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const UNIX_SYMLINK_ATTRS = 2_717_843_456;

function storedZip(
  entries: Array<{
    attrs?: number;
    data?: Uint8Array;
    name: string;
    os?: number;
  }>
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array(0);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    Buffer.from(data).copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE((entry.os ?? 0) * 256 + 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.attrs ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06_05_4b_50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

describe("PluginService", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u2-"));
    await rm(SIDE_EFFECT_MARKER, { force: true });
  });

  afterEach(async () => {
    await rm(SIDE_EFFECT_MARKER, { force: true });
    await rm(configDir, { force: true, recursive: true });
  });

  test("previews and installs a bundle without running top-level side-effect code", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const archive = validBundle();

    const preview = await service.previewPluginPackage(archive);
    expect(preview.digest).toBe(digestOf(archive));
    expect(preview.manifest.id).toBe("notes");
    expect(preview.contributions).toEqual({
      actionKeys: ["list"],
      hasDatabase: false,
      hasUi: true,
      skillKeys: ["notes"],
    });
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);

    const installed = await service.installPluginPackage(archive, {
      expectedDigest: preview.digest,
    });
    expect(installed.digest).toBe(preview.digest);
    expect(installed.releaseDir).toBe(
      getPluginReleaseDir("notes", "1.0.0", configDir)
    );
    expect(
      await readFile(join(installed.releaseDir, "nakama.plugin.json"), "utf8")
    ).toContain('"id":"notes"');
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);
    expect(existsSync(join(configDir, "plugins", ".staging"))).toBe(false);

    const stored = await db.getPluginRelease("notes", "1.0.0");
    expect(stored?.digest).toBe(preview.digest);
  });

  test("rejects traversal, encoded paths, symlinks, duplicates, and oversized expansion before writing outside staging", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const parent = dirname(configDir);
    const escapeProbe = join(parent, "nakama-plugin-escape.txt");
    await rm(escapeProbe, { force: true });

    const cases: Uint8Array[] = [
      storedZip([
        {
          data: Buffer.from(JSON.stringify(notesManifest())),
          name: "nakama.plugin.json",
        },
        { data: Buffer.from("escaped"), name: "../nakama-plugin-escape.txt" },
      ]),
      storedZip([
        {
          data: Buffer.from(JSON.stringify(notesManifest())),
          name: "nakama.plugin.json",
        },
        { data: Buffer.from("x"), name: "foo/%2e%2e/secret.js" },
      ]),
      storedZip([
        {
          data: Buffer.from(JSON.stringify(notesManifest())),
          name: "nakama.plugin.json",
        },
        { data: Buffer.from("x"), name: "foo\\..\\secret.js" },
      ]),
      storedZip([
        {
          data: Buffer.from(JSON.stringify(notesManifest())),
          name: "nakama.plugin.json",
        },
        {
          attrs: UNIX_SYMLINK_ATTRS,
          data: Buffer.from("target"),
          name: "link",
          os: 3,
        },
      ]),
      storedZip([
        { data: Buffer.from("one"), name: "a/b.txt" },
        { data: Buffer.from("two"), name: "a//b.txt" },
        {
          data: Buffer.from(JSON.stringify(notesManifest())),
          name: "nakama.plugin.json",
        },
      ]),
      encodeZip({
        "actions/list.js": sideEffectJs,
        "nakama.plugin.json": JSON.stringify(notesManifest()),
        "oversized.bin": new Uint8Array(20 * 1024 * 1024 + 1),
        "skills/notes/SKILL.md": "# Notes\n",
        "ui/assets/app.js": "export {}",
        "ui/index.html": "<html></html>",
      }),
    ];

    for (const archive of cases) {
      await expect(
        service.previewPluginPackage(archive)
      ).rejects.toBeInstanceOf(PluginHostError);
      await expect(
        service.installPluginPackage(archive)
      ).rejects.toBeInstanceOf(PluginHostError);
      expect(existsSync(escapeProbe)).toBe(false);
      expect(existsSync(getPluginReleaseDir("notes", "1.0.0", configDir))).toBe(
        false
      );
      expect(existsSync(join(configDir, "plugins", ".staging"))).toBe(false);
    }
  });

  test("failed metadata write leaves no usable half-installation and keeps the existing release", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const first = validBundle();
    await service.installPluginPackage(first);
    const existingDir = getPluginReleaseDir("notes", "1.0.0", configDir);
    const existingBytes = await readFile(
      join(existingDir, "nakama.plugin.json"),
      "utf8"
    );

    const failingDb = createInMemoryDatabaseAdapter();
    failingDb.upsertPluginRelease = async () => {
      throw new Error("metadata write failed");
    };
    const failingService = new PluginService(failingDb, configDir);
    const next = validBundle({ version: "1.1.0" });

    await expect(failingService.installPluginPackage(next)).rejects.toThrow();
    expect(existsSync(getPluginReleaseDir("notes", "1.1.0", configDir))).toBe(
      false
    );
    expect(existsSync(join(configDir, "plugins", ".staging"))).toBe(false);
    expect(await failingDb.getPluginRelease("notes", "1.1.0")).toBeNull();
    expect(
      await readFile(join(existingDir, "nakama.plugin.json"), "utf8")
    ).toBe(existingBytes);
    expect((await db.getPluginRelease("notes", "1.0.0"))?.version).toBe(
      "1.0.0"
    );
  });

  test("concurrent same-digest installs are idempotent and different bytes conflict", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const archive = validBundle();

    const [first, second] = await Promise.all([
      service.installPluginPackage(archive),
      service.installPluginPackage(archive),
    ]);

    expect(first.digest).toBe(digestOf(archive));
    expect(second.digest).toBe(first.digest);
    expect(first.releaseDir).toBe(second.releaseDir);
    expect((await db.getPluginRelease("notes", "1.0.0"))?.digest).toBe(
      first.digest
    );

    const reused = await service.installPluginPackage(archive);
    expect(reused.reused).toBe(true);

    const other = validBundle({
      description: "Different bytes under the same version",
    });
    await expect(service.installPluginPackage(other)).rejects.toMatchObject({
      code: "version_conflict",
    });
    expect((await db.getPluginRelease("notes", "1.0.0"))?.digest).toBe(
      first.digest
    );
  });

  test("install revalidates the preview digest and rejects a swapped archive", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const archive = validBundle();
    const preview = await service.previewPluginPackage(archive);
    const swapped = validBundle({ description: "tampered" });

    await expect(
      service.installPluginPackage(swapped, { expectedDigest: preview.digest })
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    expect(existsSync(getPluginReleaseDir("notes", "1.0.0", configDir))).toBe(
      false
    );
  });

  test("rejects a missing referenced file during preview", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const archive = encodeZip({
      "nakama.plugin.json": JSON.stringify(notesManifest()),
      "skills/notes/SKILL.md": "# Notes\n",
    });

    await expect(service.previewPluginPackage(archive)).rejects.toMatchObject({
      code: "missing_referenced_file",
    });
  });

  test("cleans abandoned staging without executing it", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const abandoned = join(
      configDir,
      "plugins",
      ".staging",
      "abandoned",
      "side-effect.js"
    );
    await mkdir(dirname(abandoned), { recursive: true });
    await writeFile(abandoned, sideEffectJs);

    await service.installPluginPackage(validBundle());
    expect(existsSync(join(configDir, "plugins", ".staging"))).toBe(false);
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);
  });

  test("concurrent installs of different plugins keep both releases", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const [notes, tasks] = await Promise.all([
      service.installPluginPackage(validBundle()),
      service.installPluginPackage(validBundle({ id: "tasks", name: "Tasks" })),
    ]);

    expect(notes.pluginId).toBe("notes");
    expect(tasks.pluginId).toBe("tasks");
    expect(existsSync(getPluginReleaseDir("notes", "1.0.0", configDir))).toBe(
      true
    );
    expect(existsSync(getPluginReleaseDir("tasks", "1.0.0", configDir))).toBe(
      true
    );
    expect(await db.getPluginRelease("notes", "1.0.0")).not.toBeNull();
    expect(await db.getPluginRelease("tasks", "1.0.0")).not.toBeNull();
  });
});
