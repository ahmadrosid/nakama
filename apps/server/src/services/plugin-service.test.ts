import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  appendFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { getPluginReleaseDir, PLUGIN_MANIFEST_API_VERSION } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  approvedPluginPackage,
  closePluginPackageRegistry,
  pluginPackage,
  pluginTarball,
  publishPluginPackageVersion,
} from "../testing/plugin-package-fixture";
import { createSuperNakamaTools } from "../tools/super-nakama-tools";
import { PluginService, setPluginLifecycleTestHooks } from "./plugin-service";
import type { ProfileService } from "./profile-service";
import { SuperNakamaSessionState } from "./super-nakama-session-state";

afterEach(closePluginPackageRegistry);

const SIDE_EFFECT_MARKER = join(tmpdir(), "nakama-plugin-side-effect-marker");

type Json = boolean | Json[] | { [key: string]: Json } | null | number | string;

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

function notesManifest(overrides: Record<string, Json> = {}) {
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
  overrides: Record<string, Json> = {},
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
    setPluginLifecycleTestHooks(null);
    await rm(SIDE_EFFECT_MARKER, { force: true });
    await rm(configDir, { force: true, recursive: true });
  });

  async function localDraft() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_local",
      name: "Local",
      slug: "local",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "super_local",
      isDefault: false,
      isSuper: true,
      model: null,
      name: "Super",
      orgId: "org_local",
      systemPrompt: "",
      updatedAt: now,
    });

    const draft = {
      draftId: "notes",
      orgId: "org_local",
      profileId: "super_local",
    };

    const directory = join(
      configDir,
      "orgs/org_local/profiles/super_local/plugin-drafts/notes"
    );

    const contents = {
      "actions/list.js": sideEffectJs,
      "nakama.plugin.json": JSON.stringify(notesManifest()),
      "package.json": JSON.stringify({ name: "@test/notes", version: "1.0.0" }),
      "skills/notes/SKILL.md":
        "---\nname: notes\ndescription: Notes\n---\nList notes.",
      "src/list.js": sideEffectJs,
      "ui/assets/app.js": "export {}",
      "ui/index.js": sideEffectJs,
    };

    for (const [path, content] of Object.entries(contents)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content);
    }

    return {
      actor: { id: "platform", isPlatformAdmin: true },
      db,
      directory,
      draft,
      service: new PluginService(db, configDir),
    };
  }

  test("submit_plugin_draft describes Super Nakama's own draft without installing it", async () => {
    const { db, directory, draft, service } = await localDraft();

    const submit = createSuperNakamaTools(
      // SAFETY: submit_plugin_draft never touches profile management.
      {} as ProfileService,
      new SuperNakamaSessionState(),
      undefined,
      () => service
    ).find((tool) => tool.name === "submit_plugin_draft");

    const context = { orgId: draft.orgId, profileId: draft.profileId };

    expect(
      await submit?.run({ draftId: draft.draftId }, context)
    ).toMatchObject({
      actions: ["list"],
      draftId: "notes",
      fileCount: 7,
      pluginId: "notes",
      type: "plugin_draft_ready",
    });
    expect(await db.getOrgPlugin(draft.orgId, "notes")).toBeNull();
    await expect(
      submit?.run({ draftId: draft.draftId }, { ...context, profileId: "x" })
    ).rejects.toThrow();

    const manifest = notesManifest();
    manifest.actions[0].inputSchema = {
      properties: { query: { description: "Search text", type: "string" } },
      type: "object",
    };
    await writeFile(
      join(directory, "nakama.plugin.json"),
      JSON.stringify(manifest)
    );

    await expect(
      submit?.run({ draftId: draft.draftId }, context)
    ).rejects.toThrow("invalid_manifest: unsupported_schema");
  });

  test("local review and first install publish only reviewed bytes and stay disabled", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);
    expect(preview.expectedRevision).toBeNull();
    expect(preview.files.some((file) => file.path === "src/list.js")).toBe(
      true
    );

    const file = await service.readLocalPluginFile(
      { ...draft, expectedDigest: preview.digest, path: "actions/list.js" },
      actor
    );

    expect(Buffer.from(file.content, "base64").toString()).toBe(sideEffectJs);

    const install = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    expect(install.lifecycleState).toBe("disabled");
    expect(install.databaseGeneration).toBeNull();
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);

    const release = await db.getPluginRelease(
      "notes",
      install.selectedVersion!
    );

    expect(release?.source).toBe("local");
    expect(release?.digest).toBe(preview.digest);
    expect(
      await readFile(
        join(
          getPluginReleaseDir("notes", install.selectedVersion!, configDir),
          "actions/list.js"
        ),
        "utf8"
      )
    ).toBe(sideEffectJs);
    await rm(directory, { recursive: true });
    expect(
      await service.getOrgPluginDetail("org_local", "notes")
    ).toBeDefined();
  });

  test("usage lists organizations that hold a plugin and the agents using it", async () => {
    const { db, draft, service, actor } = await localDraft();
    expect(await service.listPluginUsage("notes")).toEqual([]);

    const preview = await service.previewLocalPlugin(draft, actor);

    const install = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    const now = new Date().toISOString();
    await db.upsertTool({
      createdAt: now,
      description: "List notes",
      handlerConfig: {},
      handlerType: "plugin",
      id: "tool_notes_list",
      name: "notes_list",
      pluginId: "notes",
      updatedAt: now,
    });
    await db.assignToolToProfile("super_local", "tool_notes_list");

    expect(await service.listPluginUsage("notes")).toEqual([
      {
        agents: [{ id: "super_local", name: "Super" }],
        lifecycleState: "disabled",
        name: "Local",
        orgId: "org_local",
        revision: install.revision,
        selectedVersion: install.selectedVersion,
      },
    ]);
    expect(await service.listPluginUsage("other")).toEqual([]);
  });

  test("local install rejects changed review files without publishing", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);
    await appendFile(join(directory, "src/list.js"), "\n// changed");
    await expect(
      service.readLocalPluginFile(
        { ...draft, expectedDigest: preview.digest, path: "src/list.js" },
        actor
      )
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    await expect(
      service.installLocalPlugin(
        { ...draft, expectedDigest: preview.digest, expectedRevision: null },
        actor
      )
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    expect(await db.listPluginReleases()).toHaveLength(0);
    expect(await db.getOrgPlugin(draft.orgId, "notes")).toBeNull();
  });

  test("local reinstall reuses content, rejects stale revision, and preserves other organizations", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    const firstPreview = await service.previewLocalPlugin(draft, actor);

    const first = await service.installLocalPlugin(
      { ...draft, expectedDigest: firstPreview.digest, expectedRevision: null },
      actor
    );

    await db.upsertOrganization({
      createdAt: first.updatedAt,
      id: "org_other",
      name: "Other",
      slug: "other",
      updatedAt: first.updatedAt,
    });
    await service.addOrgPlugin("org_other", "notes", first.selectedVersion!);
    const other = await db.getOrgPlugin("org_other", "notes");

    const repeated = await service.installLocalPlugin(
      {
        ...draft,
        expectedDigest: firstPreview.digest,
        expectedRevision: first.revision,
      },
      actor
    );

    expect(repeated.selectedVersion).toBe(first.selectedVersion);
    expect(await db.listPluginReleases()).toHaveLength(1);
    await appendFile(join(directory, "actions/list.js"), "\n// changed");
    const changed = await service.previewLocalPlugin(draft, actor);
    await expect(
      service.installLocalPlugin(
        { ...draft, expectedDigest: changed.digest, expectedRevision: null },
        actor
      )
    ).rejects.toMatchObject({ code: "stale_revision" });

    const updated = await service.installLocalPlugin(
      {
        ...draft,
        expectedDigest: changed.digest,
        expectedRevision: repeated.revision,
      },
      actor
    );

    expect(updated.selectedVersion).not.toBe(first.selectedVersion);
    expect(updated.lifecycleState).toBe("disabled");
    expect(await db.getOrgPlugin("org_other", "notes")).toEqual(other);
    expect(await db.listPluginReleases()).toHaveLength(2);
  });

  test("local reinstall rejects modified release bytes without changing the installation", async () => {
    const { db, draft, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);

    const installed = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    const releaseDir = getPluginReleaseDir(
      "notes",
      installed.selectedVersion!,
      configDir
    );

    for (const path of ["actions/list.js", "unexpected.js"]) {
      const original = path === "actions/list.js" ? sideEffectJs : null;
      await writeFile(join(releaseDir, path), "export const changed = true;");
      await expect(
        service.installLocalPlugin(
          {
            ...draft,
            expectedDigest: preview.digest,
            expectedRevision: installed.revision,
          },
          actor
        )
      ).rejects.toMatchObject({ code: "digest_mismatch" });
      expect(await db.getOrgPlugin(draft.orgId, "notes")).toEqual(installed);

      if (original) {
        await writeFile(join(releaseDir, path), original);
      } else {
        await rm(join(releaseDir, path));
      }
    }
  });

  test("local review requires platform authority and a profile in the named organization", async () => {
    const { draft, service, actor } = await localDraft();
    await expect(
      service.previewLocalPlugin(draft, { ...actor, isPlatformAdmin: false })
    ).rejects.toMatchObject({ code: "forbidden" });

    for (const changes of [
      { orgId: "other" },
      { profileId: "other" },
      { draftId: "../notes" },
      { draftId: "%2e%2e" },
      { draftId: "/notes" },
    ]) {
      await expect(
        service.previewLocalPlugin({ ...draft, ...changes }, actor)
      ).rejects.toBeDefined();
    }
  });

  test("enabled local reinstall restores enabled state and migration failure preserves the previous generation", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    await mkdir(join(directory, "migrations"));
    await writeFile(
      join(directory, "migrations/001.sql"),
      "CREATE TABLE notes (body TEXT);"
    );

    const manifest = notesManifest({
      database: { migrations: [{ id: "001", path: "migrations/001.sql" }] },
    });

    await writeFile(
      join(directory, "nakama.plugin.json"),
      JSON.stringify(manifest)
    );
    const preview = await service.previewLocalPlugin(draft, actor);

    const first = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    const enabled = await service.enableOrgPlugin(
      draft.orgId,
      "notes",
      first.revision
    );

    await appendFile(join(directory, "src/list.js"), "\n// source change");
    const secondPreview = await service.previewLocalPlugin(draft, actor);

    const second = await service.installLocalPlugin(
      {
        ...draft,
        expectedDigest: secondPreview.digest,
        expectedRevision: enabled.revision,
      },
      actor
    );

    expect(second.lifecycleState).toBe("enabled");
    expect(second.selectedVersion).not.toBe(enabled.selectedVersion);
    await writeFile(join(directory, "migrations/002.sql"), "INVALID SQL;");
    await writeFile(
      join(directory, "nakama.plugin.json"),
      JSON.stringify(
        notesManifest({
          database: {
            migrations: [
              { id: "001", path: "migrations/001.sql" },
              { id: "002", path: "migrations/002.sql" },
            ],
          },
        })
      )
    );
    const broken = await service.previewLocalPlugin(draft, actor);
    await expect(
      service.installLocalPlugin(
        {
          ...draft,
          expectedDigest: broken.digest,
          expectedRevision: second.revision,
        },
        actor
      )
    ).rejects.toBeDefined();
    const recovered = await db.getOrgPlugin(draft.orgId, "notes");
    expect(recovered?.lifecycleState).toBe("disabled");
    expect(recovered?.selectedVersion).toBe(second.selectedVersion);
    expect(recovered?.databaseGeneration).toBe(second.databaseGeneration);
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);
  });

  test("local review checks host compatibility, official identity, and package versions", async () => {
    const { draft, directory, service, actor } = await localDraft();

    const changes: Record<string, Json>[] = [
      { minNakamaVersion: "999.0.0" },
      { id: "workflows" },
      { version: "2.0.0" },
      { apiVersion: 999 },
    ];

    for (const change of changes) {
      await writeFile(
        join(directory, "nakama.plugin.json"),
        JSON.stringify(notesManifest(change))
      );
      await expect(
        service.previewLocalPlugin(draft, actor)
      ).rejects.toMatchObject({ code: "invalid_manifest" });
    }
  });

  test("local review rejects official IDs even when the draft ID matches", async () => {
    const { draft, directory, service, actor } = await localDraft();
    await writeFile(
      join(directory, "nakama.plugin.json"),
      JSON.stringify(notesManifest({ id: "workflows" }))
    );
    await rename(directory, join(dirname(directory), "workflows"));
    await expect(
      service.previewLocalPlugin({ ...draft, draftId: "workflows" }, actor)
    ).rejects.toMatchObject({ code: "invalid_manifest" });
  });

  test("concurrent local installs use one revision and retained reinstall stays disabled", async () => {
    const { db, draft, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);

    const request = {
      ...draft,
      expectedDigest: preview.digest,
      expectedRevision: null,
    };

    // Hold the second draft read until the first install has published.
    const seen = new Set<string>();
    let first: Promise<unknown> = Promise.resolve();
    setPluginLifecycleTestHooks({
      async beforeLocalFileRead(path) {
        if (seen.has(path)) {
          await first.catch(() => undefined);
        }

        seen.add(path);
      },
    });
    first = service.installLocalPlugin(request, actor);

    const results = await Promise.allSettled([
      first,
      service.installLocalPlugin(request, actor),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected")
    ).toMatchObject({
      reason: { code: "stale_revision" },
    });
    const installed = (await db.getOrgPlugin(draft.orgId, "notes"))!;

    const retained = await service.uninstallOrgPlugin(
      draft.orgId,
      "notes",
      installed.revision
    );

    const restored = await service.installLocalPlugin(
      { ...request, expectedRevision: retained.revision },
      actor
    );

    expect(restored.lifecycleState).toBe("disabled");
    expect(restored.selectedVersion).toBe(installed.selectedVersion);
    expect(restored.databaseGeneration).toBe(retained.databaseGeneration);
  });

  test("failed local publication creates no organization installation", async () => {
    const { db, draft, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);
    await writeFile(join(configDir, "plugins"), "not a directory");
    await expect(
      service.installLocalPlugin(
        { ...draft, expectedDigest: preview.digest, expectedRevision: null },
        actor
      )
    ).rejects.toBeDefined();
    expect(await db.getOrgPlugin(draft.orgId, "notes")).toBeNull();
    expect(await db.listPluginReleases()).toHaveLength(0);
  });

  test("local install rejects a pending enable without changing its operation", async () => {
    const { db, draft, service, actor } = await localDraft();
    const preview = await service.previewLocalPlugin(draft, actor);

    const installed = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    setPluginLifecycleTestHooks({
      async afterMigrationBeforePublish() {
        reached.resolve();
        await resume.promise;
      },
    });

    const enabling = service.enableOrgPlugin(
      draft.orgId,
      "notes",
      installed.revision
    );

    try {
      await reached.promise;
      const pending = (await db.getOrgPlugin(draft.orgId, "notes"))!;
      await expect(
        service.installLocalPlugin(
          {
            ...draft,
            expectedDigest: preview.digest,
            expectedRevision: pending.revision,
          },
          actor
        )
      ).rejects.toMatchObject({ code: "invalid_state" });
      expect(await db.getOrgPlugin(draft.orgId, "notes")).toEqual(pending);
    } finally {
      resume.resolve();
      await enabling;
    }

    expect((await db.getOrgPlugin(draft.orgId, "notes"))?.lifecycleState).toBe(
      "enabled"
    );
  });

  test("failed first enable leaves the local release disabled without a database generation", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    await mkdir(join(directory, "migrations"));
    await writeFile(join(directory, "migrations/001.sql"), "INVALID SQL;");
    await writeFile(
      join(directory, "nakama.plugin.json"),
      JSON.stringify(
        notesManifest({
          database: { migrations: [{ id: "001", path: "migrations/001.sql" }] },
        })
      )
    );
    const preview = await service.previewLocalPlugin(draft, actor);

    const installed = await service.installLocalPlugin(
      { ...draft, expectedDigest: preview.digest, expectedRevision: null },
      actor
    );

    await expect(
      service.enableOrgPlugin(draft.orgId, "notes", installed.revision)
    ).rejects.toBeDefined();
    const failed = await db.getOrgPlugin(draft.orgId, "notes");
    expect(failed?.selectedVersion).toBe(installed.selectedVersion);
    expect(failed?.databaseGeneration).toBeNull();
    expect(failed?.lifecycleState).toBe("disabled");
  });

  test("local review rejects linked roots, linked ancestors, and excessive entry counts", async () => {
    const { draft, directory, service, actor } = await localDraft();
    const moved = directory + "-moved";
    await rename(directory, moved);
    await symlink(moved, directory);
    await expect(
      service.previewLocalPlugin(draft, actor)
    ).rejects.toMatchObject({ code: "unsafe_path" });
    await rm(directory);
    await rename(moved, directory);
    const workspace = dirname(dirname(directory));
    await rename(workspace, workspace + "-moved");
    await symlink(workspace + "-moved", workspace);
    await expect(
      service.previewLocalPlugin(draft, actor)
    ).rejects.toMatchObject({ code: "unsafe_path" });
    await rm(workspace);
    await rename(workspace + "-moved", workspace);
    await mkdir(join(directory, "src/files"));

    for (let index = 0; index < 2001; index += 1) {
      await writeFile(join(directory, "src/files", String(index)), "");
    }

    await expect(
      service.previewLocalPlugin(draft, actor)
    ).rejects.toMatchObject({ code: "expansion_limit" });
  });

  for (const kind of ["total size", "path length", "depth", "special file"]) {
    test.skipIf(kind === "special file" && process.platform === "win32")(
      `local review bounds ${kind}`,
      async () => {
        const { draft, directory, service, actor } = await localDraft();

        if (kind === "total size") {
          for (let index = 0; index < 6; index += 1) {
            const path = join(directory, "src", String(index));
            await writeFile(path, "");
            await truncate(path, 20 * 1024 * 1024);
          }
        } else if (kind === "path length") {
          await writeFile(join(directory, "src", "x".repeat(241)), "");
        } else if (kind === "depth") {
          await mkdir(
            join(directory, "src", ...Array.from({ length: 25 }, () => "d")),
            { recursive: true }
          );
        } else {
          const result = Bun.spawnSync(["mkfifo", join(directory, "src/pipe")]);
          expect(result.exitCode).toBe(0);
        }

        await expect(
          service.previewLocalPlugin(draft, actor)
        ).rejects.toMatchObject({
          code:
            kind === "total size" || kind === "depth"
              ? "expansion_limit"
              : "unsafe_path",
        });
      }
    );
  }

  test("local review rejects missing migration and worker entries and unavailable worker support", async () => {
    const { draft, directory, service, actor } = await localDraft();

    const capabilities: Record<string, Json>[] = [
      { database: { migrations: [{ id: "001", path: "migrations/001.sql" }] } },
      {
        workers: [{ entry: "workers/index.js", key: "index", name: "Indexer" }],
      },
    ];

    for (const capability of capabilities) {
      await writeFile(
        join(directory, "nakama.plugin.json"),
        JSON.stringify(notesManifest(capability))
      );
      await expect(
        service.previewLocalPlugin(draft, actor)
      ).rejects.toBeDefined();
    }

    await mkdir(join(directory, "workers"));
    await writeFile(join(directory, "workers/index.js"), sideEffectJs);
    await expect(
      service.previewLocalPlugin(draft, actor)
    ).rejects.toMatchObject({ code: "package_unavailable" });
    expect(existsSync(SIDE_EFFECT_MARKER)).toBe(false);
  });

  test("local review accepts ordinary profiles and reads large output in bounded chunks", async () => {
    const { db, draft, directory, service, actor } = await localDraft();
    const profile = (await db.getProfile(draft.profileId))!;
    await db.upsertProfile({ ...profile, isSuper: false });
    await expect(
      service.previewLocalPlugin(draft, actor)
    ).resolves.toBeDefined();
    await db.upsertProfile({ ...profile, orgId: "other" });
    await expect(
      service.previewLocalPlugin(draft, actor)
    ).rejects.toMatchObject({ code: "not_found" });
    await db.upsertProfile(profile);
    const output = Buffer.alloc(1024 * 1024 + 7, "x");
    await writeFile(join(directory, "src/large.txt"), output);
    const preview = await service.previewLocalPlugin(draft, actor);

    const first = await service.readLocalPluginFile(
      { ...draft, expectedDigest: preview.digest, path: "src/large.txt" },
      actor
    );

    expect(Buffer.from(first.content, "base64")).toEqual(
      output.subarray(0, first.nextOffset!)
    );
    expect(first.nextOffset).toBe(1024 * 1024);

    const last = await service.readLocalPluginFile(
      {
        ...draft,
        expectedDigest: preview.digest,
        offset: first.nextOffset!,
        path: "src/large.txt",
      },
      actor
    );

    expect(Buffer.from(last.content, "base64")).toEqual(
      output.subarray(first.nextOffset!)
    );
    expect(last.nextOffset).toBeNull();
  });

  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    test(`local review rejects nonempty ${field}`, async () => {
      const { draft, directory, service, actor } = await localDraft();
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "@test/notes",
          version: "1.0.0",
          [field]: { unsafe: "*" },
        })
      );
      await expect(
        service.previewLocalPlugin(draft, actor)
      ).rejects.toMatchObject({ code: "invalid_manifest" });
    });
  }

  for (const file of [
    "package.json",
    "nakama.plugin.json",
    "actions/list.js",
    "ui/index.js",
    "ui/assets/app.js",
    "skills/notes/SKILL.md",
  ]) {
    test(`local review rejects missing ${file}`, async () => {
      const { draft, directory, service, actor } = await localDraft();
      await rm(join(directory, file));
      await expect(
        service.previewLocalPlugin(draft, actor)
      ).rejects.toBeDefined();
    });
  }

  for (const kind of [
    "symlink",
    "hardlink",
    "oversized",
    "leaf replacement",
    "ancestor replacement",
  ]) {
    test(`local review rejects ${kind}`, async () => {
      const { draft, directory, service, actor } = await localDraft();
      const path = join(directory, "actions/list.js");
      const outside = join(configDir, "outside.js");
      await writeFile(outside, "private");

      if (kind === "symlink" || kind === "hardlink") {
        await rm(path);
        await (kind === "symlink"
          ? symlink(outside, path)
          : link(outside, path));
      } else if (kind === "oversized") {
        await truncate(path, 21 * 1024 * 1024);
      } else {
        let changed = false;
        setPluginLifecycleTestHooks({
          async beforeLocalFileRead(selected) {
            if (selected !== path || changed) {
              return;
            }

            changed = true;

            if (kind === "leaf replacement") {
              await rm(path);
              await symlink(outside, path);
            } else {
              await rename(
                join(directory, "actions"),
                join(directory, "old-actions")
              );
              await symlink(
                join(directory, "old-actions"),
                join(directory, "actions")
              );
            }
          },
        });
      }

      await expect(
        service.previewLocalPlugin(draft, actor)
      ).rejects.toBeDefined();
    });
  }

  test("installs rebuilt Supermemory bytes without replacing another org's release", async () => {
    const db = createInMemoryDatabaseAdapter();
    const officialPackagesDir = join(configDir, "official");
    await cp(
      resolve(import.meta.dir, "../../../../packages/plugins/supermemory"),
      join(officialPackagesDir, "supermemory"),
      { recursive: true }
    );

    const service = new PluginService(db, configDir, {
      officialPackagesDir,
      async onHostRequest() {
        return {};
      },
      workerManager: {
        async registerPluginWorkers() {},
        async unregisterPluginWorkers() {},
      },
    });

    const actor = { id: "admin", role: "admin" as const };

    const first = await service.installOfficialPlugin(
      "org-a",
      "supermemory",
      actor
    );

    const originalPath = join(
      getPluginReleaseDir("supermemory", first.selectedVersion!, configDir),
      "ui/app.js"
    );

    const original = await readFile(originalPath, "utf8");
    await appendFile(
      join(officialPackagesDir, "supermemory/ui/app.js"),
      "\n// rebuilt\n"
    );

    const second = await service.installOfficialPlugin(
      "org-b",
      "supermemory",
      actor
    );

    expect(second.lifecycleState).toBe("enabled");
    expect(second.selectedVersion).not.toBe(first.selectedVersion);
    expect(
      await readFile(
        join(
          getPluginReleaseDir(
            "supermemory",
            second.selectedVersion!,
            configDir
          ),
          "ui/app.js"
        ),
        "utf8"
      )
    ).toBe(`${original}\n// rebuilt\n`);
    expect(await readFile(originalPath, "utf8")).toBe(original);
    expect(await db.getOrgPlugin("org-a", "supermemory")).toEqual(first);

    const repeated = await service.installOfficialPlugin(
      "org-b",
      "supermemory",
      actor
    );

    expect(repeated.selectedVersion).toBe(second.selectedVersion);
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

  test("reads a restricted package only with the npm token, and keeps the token on the registry host", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new PluginService(db, configDir);
    const source = validBundle({}, { token: "npm_fixture_token" });

    await expect(service.previewPluginPackage(source)).rejects.toMatchObject({
      code: "package_unavailable",
    });

    process.env.NAKAMA_PLUGIN_NPM_TOKEN = "npm_fixture_token";

    try {
      const preview = await service.previewPluginPackage(source);

      const installed = await service.installPluginPackage(source, {
        expectedDigest: preview.digest,
      });

      expect(installed.digest).toBe(preview.digest);
      expect(
        JSON.stringify(await db.getPluginRelease("notes", "1.0.0"))
      ).not.toContain("npm_fixture_token");

      publishPluginPackageVersion(source.packageName, "1.1.0");

      expect(await service.listPluginUpdates()).toEqual([
        {
          packageName: source.packageName,
          pluginId: "notes",
          version: "1.1.0",
        },
      ]);

      await expect(
        service.previewPluginPackage(
          validBundle({}, { tarball: "https://registry.example/notes.tgz" })
        )
      ).rejects.toMatchObject({ code: "invalid_package" });
    } finally {
      delete process.env.NAKAMA_PLUGIN_NPM_TOKEN;
    }
  });

  test("requires bundled dependencies and matching package identity", async () => {
    const service = new PluginService(
      createInMemoryDatabaseAdapter(),
      configDir
    );

    const packageJsons: Record<string, Json>[] = [
      { dependencies: { lodash: "1.0.0" } },
      { optionalDependencies: { lodash: "1.0.0" } },
      { peerDependencies: { lodash: "1.0.0" } },
      { name: "another-package" },
      { version: "2.0.0" },
    ];

    for (const packageJson of packageJsons) {
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
