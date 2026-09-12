import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { getPluginReleaseDir, PLUGIN_MANIFEST_API_VERSION } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  approvedPluginPackage,
  pluginPackage,
  pluginTarball,
} from "../testing/plugin-package-fixture";
import { PluginService } from "./plugin-service";

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
      entryModule: "ui/index.js",
      pageLabel: "Notes",
    },
    ...identity,
    ...overrides,
  };
}

function validBundle(
  overrides: Record<string, unknown> = {},
  options?: Parameters<typeof pluginPackage>[1]
): ReturnType<typeof pluginPackage> {
  const manifest = notesManifest(overrides);
  return pluginPackage(
    {
      "actions/list.js": sideEffectJs,
      "nakama.plugin.json": JSON.stringify(manifest),
      "side-effect.js": sideEffectJs,
      "skills/notes/SKILL.md": "# Notes\n",
      "ui/assets/app.js": "export {}",
      "ui/index.js": "<html></html>",
    },
    options
  );
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

  test("previews and installs a npm package without running top-level side-effect code", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const icon = "https://example.com/notes.svg";
    const archive = validBundle({ icon });

    const preview = await service.previewPluginPackage(archive);
    expect(preview.digest).toBe(approvedPluginPackage(archive).expectedDigest);
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
    expect(stored?.manifest.icon).toBe(icon);
    expect((await service.getOrgPluginDetail("org-a", "notes"))?.icon).toBe(
      icon
    );
  });

  test("rejects traversal, encoded paths, symlinks, duplicates, and oversized expansion before writing outside staging", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const parent = dirname(configDir);
    const escapeProbe = join(parent, "nakama-plugin-escape.txt");
    await rm(escapeProbe, { force: true });

    const cases = [
      ...[
        "../nakama-plugin-escape.txt",
        "foo/%2e%2e/secret.js",
        "foo\\..\\secret.js",
        "/absolute.txt",
      ].map((name) => ({
        code: "unsafe_path",
        source: pluginPackage(
          {},
          {
            archive: pluginTarball([
              { data: Buffer.from("escaped"), name: `package/${name}` },
            ]),
          }
        ),
      })),
      ...(["SymbolicLink", "Link"] as const).map((type) => ({
        code: "unsupported_entry",
        source: pluginPackage(
          {},
          { archive: pluginTarball([{ name: "package/link", type }]) }
        ),
      })),
      {
        code: "duplicate_entry",
        source: pluginPackage(
          {},
          {
            archive: pluginTarball([
              { name: "package/a.txt" },
              { name: "package/a.txt" },
            ]),
          }
        ),
      },
      {
        code: "expansion_limit",
        source: pluginPackage({
          "oversized.bin": new Uint8Array(20 * 1024 * 1024 + 1),
        }),
      },
      {
        code: "expansion_limit",
        source: pluginPackage(
          {},
          {
            archive: pluginTarball(
              Array.from({ length: 2001 }, (_, index) => ({
                name: `package/${index}.txt`,
              }))
            ),
          }
        ),
      },
      {
        code: "archive_too_large",
        source: pluginPackage(
          {},
          { archive: Buffer.alloc(20 * 1024 * 1024 + 1) }
        ),
      },
      {
        code: "invalid_archive",
        source: pluginPackage(
          {},
          { archive: gzipSync(Buffer.alloc(100 * 1024 * 1024 + 1)) }
        ),
      },
      {
        code: "invalid_archive",
        source: pluginPackage({}, { archive: Buffer.from("not a tarball") }),
      },
    ];

    for (const { source, code } of cases) {
      await expect(service.previewPluginPackage(source)).rejects.toMatchObject({
        code,
      });
      await expect(service.installPluginPackage(source)).rejects.toMatchObject({
        code,
      });
      expect(existsSync(escapeProbe)).toBe(false);
      expect(existsSync(getPluginReleaseDir("notes", "1.0.0", configDir))).toBe(
        false
      );
      expect(existsSync(join(configDir, "plugins", ".staging"))).toBe(false);
    }
  });

  test("only accepts registry package names and exact versions", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );
    for (const packageName of [
      "file:./plugin",
      "https://example.com/a.tgz",
      "github:user/repo",
      "../local",
      "@scope/name@1.0.0",
    ]) {
      await expect(
        service.previewPluginPackage({ packageName, version: "1.0.0" })
      ).rejects.toMatchObject({ code: "invalid_package" });
    }
    for (const version of ["latest", "^1.0.0", "1", "*", "1.0.0 || 2.0.0"]) {
      await expect(
        service.previewPluginPackage({ packageName: "notes", version })
      ).rejects.toMatchObject({ code: "invalid_package" });
    }
  });

  test("pins approved integrity and verifies downloaded bytes", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const source = validBundle();
    await expect(
      service.installPluginPackage(source, {
        ...approvedPluginPackage(source),
        expectedIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      })
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    const corrupted = validBundle(
      {},
      { integrity: `sha512-${Buffer.alloc(64).toString("base64")}` }
    );
    await expect(service.previewPluginPackage(corrupted)).rejects.toMatchObject(
      { code: "package_unavailable" }
    );
    expect(await db.getPluginRelease("notes", "1.0.0")).toBeNull();
    expect(existsSync(getPluginReleaseDir("notes", "1.0.0", configDir))).toBe(
      false
    );
  });

  test("requires bundled dependencies and matching package identity", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );
    for (const packageJson of [
      { dependencies: { lodash: "1.0.0" } },
      { optionalDependencies: { lodash: "1.0.0" } },
      { peerDependencies: { lodash: "1.0.0" } },
      { name: "another-package" },
      { version: "2.0.0" },
    ]) {
      await expect(
        service.previewPluginPackage(validBundle({}, { packageJson }))
      ).rejects.toMatchObject({ code: "invalid_manifest" });
    }
  });

  test("does not run npm lifecycle scripts or install dev dependencies", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );
    const command = `bun -e 'require("fs").writeFileSync(${JSON.stringify(SIDE_EFFECT_MARKER)}, "ran")'`;
    const source = validBundle(
      {},
      {
        packageJson: {
          devDependencies: { "this-package-does-not-exist": "1.0.0" },
          scripts: {
            install: command,
            postinstall: command,
            preinstall: command,
            prepare: command,
          },
        },
      }
    );
    await service.previewPluginPackage(source);
    const installed = await service.installPluginPackage(
      source,
      approvedPluginPackage(source)
    );
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);
    expect(existsSync(join(installed.releaseDir, "node_modules"))).toBe(false);
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

    expect(first.digest).toBe(approvedPluginPackage(archive).expectedDigest);
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
    const archive = pluginPackage({
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
