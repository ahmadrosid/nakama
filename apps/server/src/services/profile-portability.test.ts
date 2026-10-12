import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCustomToolsDir, slugifyProfileName } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { unzipSync, zipSync } from "fflate";
import { AuthService } from "./auth-service";
import {
  createNakamaDataExport,
  previewNakamaDataImport,
} from "./data-portability";
import { OrgService } from "./org-service";
import {
  createProfilePackExport,
  importProfilePack,
  PROFILE_PACK_KIND,
  previewProfilePackImport,
} from "./profile-portability";
import { ProfileService } from "./profile-service";
import { SkillsService } from "./skills-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

const ORG = "org_test";

const DEST = "org_dest";

const VICTIM = "org_victim";

describe("profile portability", () => {
  let root = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (root) {
      await rm(root, { force: true, recursive: true });
      root = "";
    }
  });

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-pack-"));
    process.env.NAKAMA_CONFIG_DIR = root;
    const db = createInMemoryDatabaseAdapter();

    return { db, service: new ProfileService(db) };
  }

  const soul = (orgId: string, profileId: string) =>
    path.join(root, "orgs", orgId, "profiles", profileId);

  const now = () => new Date().toISOString();

  test.each(["workspace", "avatar"] as const)(
    "profile packs exclude parent bytes through a linked %s",
    async (mode) => {
      const { db, service } = await setup();

      const { profile: parent } = await service.createProfile(ORG, {
        name: "Parent",
      });

      const { profile: team } = await service.createProfile(DEST, {
        name: "Team",
      });

      await writeFile(
        path.join(soul(ORG, parent.id), "MEMORY.md"),
        "parent_private"
      );

      if (mode === "workspace") {
        await rm(soul(DEST, team.id), { force: true, recursive: true });
        await symlink(soul(ORG, parent.id), soul(DEST, team.id), "dir");
        await expect(
          createProfilePackExport(db, DEST, team.id)
        ).rejects.toMatchObject({ status: 400 });
      } else {
        await symlink(
          path.join(soul(ORG, parent.id), "MEMORY.md"),
          path.join(soul(DEST, team.id), "avatar.png")
        );
        const exported = await createProfilePackExport(db, DEST, team.id);
        const entries = unzipSync(exported.data);
        expect(entries["avatar.png"]).toBeUndefined();
        expect(
          Object.values(entries)
            .map((entry) => Buffer.from(entry).toString())
            .join("\n")
        ).not.toContain("parent_private");
      }

      expect(await db.getProfileForOrg(team.id, DEST)).toMatchObject({
        id: team.id,
        orgId: DEST,
      });
      expect(
        await readFile(path.join(soul(ORG, parent.id), "MEMORY.md"), "utf8")
      ).toBe("parent_private");
    }
  );

  test("shared packs retain references and require a valid destination publication", async () => {
    const { db, service } = await setup();
    const orgService = new OrgService(db, new AuthService());
    service.setOrgService(orgService);
    const timestamp = now();
    const verifiedTeam = "org_verified";

    for (const id of [ORG, DEST, VICTIM, verifiedTeam]) {
      await db.upsertOrganization({
        createdAt: timestamp,
        id,
        name: id,
        parentOrgId: [DEST, verifiedTeam].includes(id) ? ORG : null,
        slug: id,
        updatedAt: timestamp,
      });
    }

    const { profile: source } = await service.createProfile(ORG, {
      name: "Shared source",
      systemPrompt: "Published instructions",
    });

    const publication = await db.publishOrgSharedResource({
      createdAt: timestamp,
      id: "shared_pack_publication",
      orgId: ORG,
      resourceId: source.id,
      resourceKind: "agent",
      updatedAt: timestamp,
    });

    const instance = await db.createSharedAgentInstance(
      DEST,
      publication.id,
      "shared_pack_instance",
      timestamp
    );

    await mkdir(soul(DEST, instance.id), { recursive: true });
    await writeFile(
      path.join(soul(DEST, instance.id), "MEMORY.md"),
      "Team memory"
    );
    const exported = await createProfilePackExport(db, DEST, instance.id);

    const reference = {
      publicationId: publication.id,
      sourceOrgId: ORG,
      sourceProfileId: source.id,
    };

    expect(exported.manifest.meta.sharedAgent).toEqual(reference);
    await db.upsertTool({
      createdAt: timestamp,
      description: "Destination tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "pack_destination_tool",
      name: "pack_destination_tool",
      orgId: VICTIM,
      updatedAt: timestamp,
    });

    const crafted = repack(exported.data, {
      "nakama-profile-export.json": JSON.stringify({
        ...exported.manifest,
        meta: {
          ...exported.manifest.meta,
          bundledSkillNames: ["missing_skill"],
          composioToolkitSlugs: ["missing_toolkit"],
          mcpServerNames: ["missing_server"],
          orgId: ORG,
          parentOrgId: ORG,
          sharedResources: [
            {
              id: publication.id,
              orgId: ORG,
              resourceId: source.id,
              resourceKind: "agent",
            },
          ],
          toolNames: ["pack_destination_tool"],
        },
      }),
    });

    expect(
      (await previewProfilePackImport(db, VICTIM, crafted)).skippedAssignments
    ).toEqual([]);

    const imported = await importProfilePack(db, VICTIM, crafted, {
      confirm: true,
    });

    expect(imported.profileId).not.toBe(instance.id);
    expect(
      await db.getSharedAgentInstance(VICTIM, imported.profileId)
    ).toMatchObject({
      ...reference,
      profileId: imported.profileId,
      teamOrgId: VICTIM,
    });
    expect(
      (await service.getProfile(VICTIM, imported.profileId)).profile.sharedAgent
        ?.available
    ).toBe(false);
    await expect(
      orgService.resolveSharedAgentProfile(VICTIM, imported.profileId)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.updateProfile(VICTIM, imported.profileId, { name: "Local edit" })
    ).rejects.toMatchObject({ status: 403 });
    expect((await db.getOrganizationById(VICTIM))?.parentOrgId).toBeNull();
    expect(await db.listOrgSharedResources(VICTIM)).toEqual([]);
    expect(await db.listToolsForProfile(imported.profileId)).toEqual([]);
    expect(
      await readFile(
        path.join(soul(VICTIM, imported.profileId), "MEMORY.md"),
        "utf8"
      )
    ).toBe("Team memory");

    const reexported = await createProfilePackExport(
      db,
      VICTIM,
      imported.profileId
    );

    expect(reexported.manifest.meta.sharedAgent).toEqual(reference);

    const verified = await importProfilePack(db, verifiedTeam, exported.data, {
      confirm: true,
    });

    expect(
      (await service.getProfile(verifiedTeam, verified.profileId)).profile
        .sharedAgent?.available
    ).toBe(true);
    const profilesBefore = await db.listProfiles();

    const linkBefore = await db.getSharedAgentInstance(
      verifiedTeam,
      verified.profileId
    );

    await expect(
      importProfilePack(db, verifiedTeam, exported.data, { confirm: true })
    ).rejects.toThrow();
    expect(await db.listProfiles()).toEqual(profilesBefore);
    expect(
      await db.getSharedAgentInstance(verifiedTeam, verified.profileId)
    ).toEqual(linkBefore);
    await db.deleteOrgSharedResource(ORG, publication.id);
    expect(
      (await service.getProfile(verifiedTeam, verified.profileId)).profile
        .sharedAgent?.available
    ).toBe(false);
    await expect(
      orgService.resolveSharedAgentProfile(verifiedTeam, verified.profileId)
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await readFile(
        path.join(soul(verifiedTeam, verified.profileId), "MEMORY.md"),
        "utf8"
      )
    ).toBe("Team memory");
  });

  test("invalid shared pack references are rejected before creating profiles", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Pack source",
    });

    const exported = await createProfilePackExport(db, ORG, profile.id);
    const profilesBefore = await db.listProfiles();

    for (const sharedAgent of [
      null,
      {},
      { publicationId: "", sourceOrgId: ORG, sourceProfileId: profile.id },
      { publicationId: 123, sourceOrgId: ORG, sourceProfileId: profile.id },
      { publicationId: "pub", sourceOrgId: false, sourceProfileId: profile.id },
      {
        publicationId: "pub",
        sourceOrgId: ORG,
        sourceProfileId: "x".repeat(257),
      },
    ]) {
      const crafted = repack(exported.data, {
        "nakama-profile-export.json": JSON.stringify({
          ...exported.manifest,
          meta: { ...exported.manifest.meta, sharedAgent },
        }),
      });

      await expect(
        previewProfilePackImport(db, DEST, crafted)
      ).rejects.toThrow();
      await expect(
        importProfilePack(db, DEST, crafted, { confirm: true })
      ).rejects.toThrow();
    }

    expect(await db.listProfiles()).toEqual(profilesBefore);
  });

  test("pack provenance and name collisions cannot overwrite a shared instance or its source", async () => {
    const { db, service } = await setup();
    const timestamp = now();

    for (const id of [ORG, DEST, VICTIM]) {
      await db.upsertOrganization({
        createdAt: timestamp,
        id,
        name: id,
        parentOrgId: id === DEST ? ORG : null,
        slug: id,
        updatedAt: timestamp,
      });
    }

    const { profile: source } = await service.createProfile(ORG, {
      name: "Published template",
      systemPrompt: "Source instructions",
    });

    const publication = await db.publishOrgSharedResource({
      createdAt: timestamp,
      id: "publication",
      orgId: ORG,
      resourceId: source.id,
      resourceKind: "agent",
      updatedAt: timestamp,
    });

    const name = "Shared instance";

    const instance = await db.createSharedAgentInstance(
      DEST,
      publication.id,
      slugifyProfileName(name),
      timestamp
    );

    const link = await db.getSharedAgentInstance(DEST, instance.id);
    const storedSource = await db.getProfile(source.id);
    const teamDir = soul(DEST, instance.id);
    await mkdir(teamDir, { recursive: true });

    const files = [
      "SOUL.md",
      "STYLE.md",
      "INSTRUCTIONS.md",
      "MEMORY.md",
      "USER.md",
    ];

    for (const file of files) {
      await writeFile(path.join(teamDir, file), `Team ${file}`);
    }

    const { profile: local } = await service.createProfile(VICTIM, {
      name: "Local pack",
      soulFiles: { "SOUL.md": "Imported identity" },
      systemPrompt: "Imported instructions",
    });

    const exported = await createProfilePackExport(db, VICTIM, local.id);

    for (const revoked of [false, true]) {
      if (revoked) {
        await db.deleteOrgSharedResource(ORG, publication.id);
      }

      const crafted = repack(exported.data, {
        "nakama-profile-export.json": JSON.stringify({
          ...exported.manifest,
          meta: {
            ...exported.manifest.meta,
            id: instance.id,
            name,
            orgId: ORG,
          },
          orgId: ORG,
          parentOrgId: VICTIM,
          sourceProfileId: revoked ? source.id : instance.id,
        }),
      });

      const imported = await importProfilePack(db, DEST, crafted, {
        confirm: true,
      });

      expect(imported.profileId).not.toBe(instance.id);
      expect(imported.profileId).not.toBe(source.id);
      expect(await db.getProfile(imported.profileId)).toMatchObject({
        orgId: DEST,
        systemPrompt: "Imported instructions",
      });
      expect(
        await db.getSharedAgentInstance(DEST, imported.profileId)
      ).toBeNull();
      expect(await db.getProfile(instance.id)).toEqual(instance);
      expect(await db.getProfile(source.id)).toEqual(storedSource);
      expect(await db.getSharedAgentInstance(DEST, instance.id)).toEqual(link);
      expect(await db.listProfileChangeEvents(DEST, instance.id)).toEqual([]);
      expect((await db.getOrganizationById(DEST))?.parentOrgId).toBe(ORG);
      expect(await db.listOrgSharedResources(DEST)).toEqual([]);

      for (const file of files) {
        expect(await readFile(path.join(teamDir, file), "utf8")).toBe(
          `Team ${file}`
        );
      }
    }
  });

  async function writeSkill(
    db: ReturnType<typeof createInMemoryDatabaseAdapter>,
    orgId: string,
    profileId: string,
    name: string
  ) {
    const dir = path.join(soul(orgId, profileId), "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}.\n---\n\nBody.\n`,
      "utf8"
    );
    const id = `skill_${name}`;
    await db.upsertSkill({
      createdAt: now(),
      createdBy: "human",
      description: `${name}.`,
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id,
      name,
      orgId,
      sourcePath: dir,
      updatedAt: now(),
    });
    await db.assignSkillToProfile(profileId, id);
  }

  /** Re-zips a real pack with attacker-chosen entries grafted in. */
  function repack(archive: Buffer, extra: Record<string, string>): Buffer {
    const entries = unzipSync(new Uint8Array(archive));

    for (const [name, source] of Object.entries(extra)) {
      entries[name] = new Uint8Array(Buffer.from(source, "utf8"));
    }

    return Buffer.from(zipSync(entries));
  }

  /** A skill tool that proves execution by leaving a file behind. */
  const exfiltratingTool = (marker: string) =>
    [
      'import { writeFileSync } from "node:fs";',
      `export async function run() { writeFileSync(${JSON.stringify(marker)}, "pwned"); return "ok"; }`,
      "",
    ].join("\n");

  test("export packs soul content and skips secrets, artifacts, and archives", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Research Bot",
      systemPrompt: "research",
    });

    const dir = soul(ORG, profile.id);
    await writeFile(path.join(dir, "MEMORY.md"), "- fact\n", "utf8");
    await mkdir(path.join(dir, "knowledge-base"), { recursive: true });
    await writeFile(
      path.join(dir, "knowledge-base", "doc_1--notes.txt"),
      "kb",
      "utf8"
    );
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await writeFile(path.join(dir, "artifacts", "report.txt"), "gen", "utf8");
    await mkdir(path.join(dir, "skills", ".archive", "old"), {
      recursive: true,
    });
    await writeFile(
      path.join(dir, "skills", ".archive", "old", "SKILL.md"),
      "---\nname: old\ndescription: x\n---\n",
      "utf8"
    );
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo", env: { SECRET: "shh" } },
      createdAt: now(),
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "Echo",
      orgId: ORG,
      status: "disconnected",
      transport: "stdio",
      updatedAt: now(),
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_1");

    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(exported.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(exported.manifest.meta.mcpServerNames).toEqual(["Echo"]);
    expect(exported.manifest.topLevelPaths).toContain("MEMORY.md");
    expect(
      exported.manifest.skipped.some((item) => item.path === "artifacts")
    ).toBe(true);

    const names = Object.keys(unzipSync(new Uint8Array(exported.data)));
    expect(names).toContain("MEMORY.md");
    expect(names).toContain("knowledge-base/doc_1--notes.txt");
    expect(names.some((name) => name.includes("artifacts"))).toBe(false);
    expect(names.some((name) => name.includes(".archive"))).toBe(false);
    expect(names).not.toContain("config.ini");
    expect(names.some((name) => name.toLowerCase().includes("mcp"))).toBe(
      false
    );

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    const dest = soul(DEST, imported.profileId);
    await expect(
      readFile(path.join(dest, "MEMORY.md"), "utf8")
    ).resolves.toContain("fact");
    await expect(
      readFile(path.join(dest, "knowledge-base", "doc_1--notes.txt"), "utf8")
    ).resolves.toBe("kb");
    await expect(
      readFile(path.join(dest, "artifacts", "report.txt"), "utf8")
    ).rejects.toThrow();
  });

  test("import creates a new profile and resolves tools by name", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      model: "anthropic:claude-sonnet-4-6",
      name: "Support Bot",
      systemPrompt: "help",
    });

    await db.upsertTool({
      createdAt: now(),
      description: "Custom",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_src",
      name: "custom_tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_src");
    const exported = await createProfilePackExport(db, ORG, profile.id);

    await db.deleteTool("tool_src");
    await db.upsertTool({
      createdAt: now(),
      description: "Custom",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_dest",
      name: "custom_tool",
      updatedAt: now(),
    });

    const preview = await previewProfilePackImport(db, DEST, exported.data);
    expect(preview.plannedName).toBe("Support Bot");
    expect(
      preview.skippedAssignments.some((s) => s.path.startsWith("tool:"))
    ).toBe(false);

    const before = (await db.listProfilesForOrg(DEST)).length;

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(imported.profileId).not.toBe(profile.id);
    expect(await db.listProfilesForOrg(DEST)).toHaveLength(before + 1);
    expect((await db.getProfileForOrg(imported.profileId, DEST))?.model).toBe(
      "anthropic:claude-sonnet-4-6"
    );
    expect(
      (await db.listToolsForProfile(imported.profileId)).map((t) => t.id)
    ).toContain("tool_dest");
  });

  test("import never assigns a tool owned by another organization", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Scoped Tool Bot",
    });

    await db.upsertTool({
      createdAt: now(),
      description: "Source tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_source",
      name: "victim_tool",
      orgId: ORG,
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_source");
    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(exported.manifest.meta.toolNames).toEqual(["victim_tool"]);

    await db.deleteTool("tool_source");
    await db.upsertTool({
      createdAt: now(),
      description: "Owned by another tenant",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_victim",
      name: "victim_tool",
      orgId: VICTIM,
      updatedAt: now(),
    });

    const preview = await previewProfilePackImport(db, DEST, exported.data);
    expect(
      preview.skippedAssignments.some(
        (item) => item.path === "tool:victim_tool"
      )
    ).toBe(true);

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(
      imported.skippedAssignments.some(
        (item) => item.path === "tool:victim_tool"
      )
    ).toBe(true);
    expect(await db.listToolsForProfile(imported.profileId)).toEqual([]);

    // The importing organization's own tool of the same name still resolves.
    await db.upsertTool({
      createdAt: now(),
      description: "Owned by the importing tenant",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_dest",
      name: "victim_tool",
      orgId: DEST,
      updatedAt: now(),
    });

    const local = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(
      (await db.listToolsForProfile(local.profileId)).map((tool) => tool.id)
    ).toEqual(["tool_dest"]);
  });

  test("export packs assigned custom tool source and import restores it", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Tool Bot",
    });

    const toolsDir = getCustomToolsDir(ORG);
    const modulePath = "portable-echo.js";

    const source = `export async function run(input, context) {
  return input;
}
`;

    await mkdir(toolsDir, { recursive: true });
    await writeFile(path.join(toolsDir, modulePath), source, "utf8");
    await db.upsertTool({
      createdAt: now(),
      description: "Echo input",
      handlerConfig: { modulePath },
      handlerType: "javascript",
      id: "tool_portable",
      name: "portable_echo",
      orgId: ORG,
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_portable");

    const exported = await createProfilePackExport(db, ORG, profile.id, {
      includeCustomTools: true,
    });

    expect(exported.manifest.meta.customTools).toEqual([
      expect.objectContaining({
        handlerType: "javascript",
        name: "portable_echo",
      }),
    ]);

    expect(Object.keys(unzipSync(new Uint8Array(exported.data)))).toContain(
      "custom-tools/portable-echo.js"
    );

    await rm(path.join(toolsDir, modulePath));
    const unprivilegedDb = createInMemoryDatabaseAdapter();

    const unprivilegedPreview = await previewProfilePackImport(
      unprivilegedDb,
      DEST,
      exported.data
    );

    expect(
      unprivilegedPreview.skippedAssignments.some((item) =>
        item.reason.includes("platform admin")
      )
    ).toBe(true);

    const unprivilegedImport = await importProfilePack(
      unprivilegedDb,
      DEST,
      exported.data,
      { confirm: true }
    );

    expect(await unprivilegedDb.getToolByName("portable_echo")).toBeNull();
    expect(
      await unprivilegedDb.listToolsForProfile(unprivilegedImport.profileId)
    ).toEqual([]);

    const conflictingDb = createInMemoryDatabaseAdapter();
    await conflictingDb.upsertTool({
      createdAt: now(),
      description: "Built-in collision",
      handlerConfig: {},
      handlerType: "builtin",
      id: "tool_conflict",
      name: "portable_echo",
      updatedAt: now(),
    });

    const conflictingPreview = await previewProfilePackImport(
      conflictingDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );

    expect(
      conflictingPreview.skippedAssignments.some((item) =>
        item.reason.includes("conflicts")
      )
    ).toBe(true);

    const destinationDb = createInMemoryDatabaseAdapter();

    const preview = await previewProfilePackImport(
      destinationDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );

    expect(
      preview.skippedAssignments.some((item) =>
        item.path.includes("portable_echo")
      )
    ).toBe(false);

    const imported = await importProfilePack(
      destinationDb,
      DEST,
      exported.data,
      { confirm: true, restoreCustomTools: true }
    );

    const restored = await destinationDb.getToolByName("portable_echo");

    if (!restored) {
      throw new Error("Expected imported custom tool");
    }

    expect(restored).toMatchObject({
      description: "Echo input",
      handlerConfig: { modulePath },
      handlerType: "javascript",
    });
    expect(
      (await destinationDb.listToolsForProfile(imported.profileId)).map(
        (tool) => tool.id
      )
    ).toContain(restored.id);
    await expect(
      readFile(path.join(getCustomToolsDir(DEST), modulePath), "utf8")
    ).resolves.toBe(source);

    const reused = await importProfilePack(destinationDb, DEST, exported.data, {
      confirm: true,
      restoreCustomTools: true,
    });

    expect(
      (await destinationDb.listToolsForProfile(reused.profileId)).map(
        (tool) => tool.id
      )
    ).toContain(restored.id);

    await writeFile(
      path.join(getCustomToolsDir(DEST), modulePath),
      "export async function run() { return 'changed'; }\n",
      "utf8"
    );

    const changedPreview = await previewProfilePackImport(
      destinationDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );

    expect(
      changedPreview.skippedAssignments.some((item) =>
        item.reason.includes("conflicts")
      )
    ).toBe(true);
  });

  test.each([false, true])(
    "tenant export excludes parent tool source with publication=%s",
    async (published) => {
      const { db, service } = await setup();
      const timestamp = now();

      for (const id of [VICTIM, ORG]) {
        await db.upsertOrganization({
          createdAt: timestamp,
          id,
          name: id,
          parentOrgId: id === ORG ? VICTIM : null,
          slug: id,
          updatedAt: timestamp,
        });
      }

      const { profile } = await service.createProfile(ORG, {
        name: "Team agent",
      });

      const { profile: source } = await service.createProfile(VICTIM, {
        name: "Parent source",
      });

      const skill = (
        await new SkillsService(db).createSkill(VICTIM, {
          body: "parent-private-instructions",
          description: "Parent notes",
          name: "parent-only",
          profileId: source.id,
        })
      ).skill;

      await db.assignSkillToProfile(profile.id, skill.id);
      await mkdir(getCustomToolsDir(), { recursive: true });
      await writeFile(
        path.join(getCustomToolsDir(), "parent.js"),
        "export async function run() { return 'parent-private-source'; }\n"
      );
      await db.upsertTool({
        createdAt: timestamp,
        description: "Parent tool",
        handlerConfig: { modulePath: "parent.js" },
        handlerType: "javascript",
        id: "parent_tool",
        name: "parent_tool",
        orgId: VICTIM,
        updatedAt: timestamp,
      });
      await db.assignToolToProfile(profile.id, "parent_tool");

      if (published) {
        await db.publishOrgSharedResource({
          createdAt: timestamp,
          id: "published_tool",
          orgId: VICTIM,
          resourceId: "parent_tool",
          resourceKind: "tool",
          updatedAt: timestamp,
        });
      }

      const exported = await createProfilePackExport(db, ORG, profile.id, {
        includeCustomTools: true,
      });

      expect(exported.manifest.meta.toolNames).not.toContain("parent_tool");
      expect(exported.manifest.meta.profileSkillNames).not.toContain(
        "parent-only"
      );
      expect(exported.manifest.meta.bundledSkillNames).not.toContain(
        "parent-only"
      );
      expect(exported.manifest.meta.customTools).toEqual([]);
      const entries = unzipSync(new Uint8Array(exported.data));
      expect(
        Object.keys(entries).some((name) => name.startsWith("custom-tools/"))
      ).toBe(false);
      expect(
        Object.values(entries).some((bytes) =>
          Buffer.from(bytes).includes("parent-private-source")
        )
      ).toBe(false);
      expect(
        Object.values(entries).some((bytes) =>
          Buffer.from(bytes).includes("parent-private-instructions")
        )
      ).toBe(false);
      expect(
        await readFile(path.join(getCustomToolsDir(), "parent.js"), "utf8")
      ).toContain("parent-private-source");
      expect(await db.listToolsForProfile(profile.id)).toHaveLength(1);

      const imported = await importProfilePack(db, ORG, exported.data, {
        confirm: true,
        name: "Imported team agent",
      });

      expect(await db.listToolsForProfile(imported.profileId)).toEqual([]);
      expect(await db.listSkillsForProfile(imported.profileId)).toEqual([]);
    }
  );

  test("custom tool source is omitted when export is not privileged", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Restricted Tool Bot",
    });

    const toolsDir = getCustomToolsDir();
    await mkdir(toolsDir, { recursive: true });
    await writeFile(
      path.join(toolsDir, "restricted.js"),
      "export async function run() {}\n",
      "utf8"
    );
    await db.upsertTool({
      createdAt: now(),
      description: "Restricted",
      handlerConfig: { modulePath: "restricted.js" },
      handlerType: "javascript",
      id: "tool_restricted",
      name: "restricted_tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_restricted");

    const exported = await createProfilePackExport(db, ORG, profile.id, {
      includeCustomTools: false,
    });

    expect(exported.manifest.meta.customTools).toBeUndefined();
    expect(
      Object.keys(unzipSync(new Uint8Array(exported.data))).some((name) =>
        name.startsWith("custom-tools/")
      )
    ).toBe(false);
  });

  test("missing destination MCP is skipped; packed skills assign or collide", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Mixed Bot" });
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo" },
      createdAt: now(),
      enabled: true,
      id: "mcp_gone",
      lastError: null,
      name: "MissingServer",
      orgId: ORG,
      status: "disconnected",
      transport: "stdio",
      updatedAt: now(),
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_gone");
    await writeSkill(db, ORG, profile.id, "my-skill");

    const exported = await createProfilePackExport(db, ORG, profile.id);

    const destDb = createInMemoryDatabaseAdapter();

    const skippedImport = await importProfilePack(destDb, DEST, exported.data, {
      confirm: true,
    });

    expect(
      skippedImport.skippedAssignments.some((item) =>
        item.path.includes("MissingServer")
      )
    ).toBe(true);
    expect(
      await destDb.listMcpServersForProfile(skippedImport.profileId)
    ).toEqual([]);

    const first = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(
      (await db.listSkillsForProfile(first.profileId)).map((s) => s.name)
    ).toContain("my-skill");

    const second = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(
      second.skippedAssignments.some((item) => item.reason.includes("my-skill"))
    ).toBe(true);
  });

  test("pack import only attaches MCP servers granted to the importing org", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Privileged Bot",
    });

    await db.upsertMcpServer({
      cachedTools: [{ description: "drop db", inputSchema: {}, name: "drop" }],
      config: {
        env: { PROD_TOKEN: "shh" },
        headers: { authorization: "Bearer prod" },
      },
      createdAt: now(),
      enabled: true,
      id: "mcp_prod",
      lastError: null,
      name: "Production Admin MCP",
      status: "connected",
      transport: "http",
      updatedAt: now(),
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_prod");

    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(exported.manifest.meta.mcpServerNames).toEqual([
      "Production Admin MCP",
    ]);

    const preview = await previewProfilePackImport(db, DEST, exported.data);
    expect(
      preview.skippedAssignments.some(
        (item) =>
          item.path === "MCP server:Production Admin MCP" &&
          item.reason.includes("not available to this organization")
      )
    ).toBe(true);

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    expect(
      (await db.listMcpServersForProfile(imported.profileId)).map(
        (server) => server.id
      )
    ).toEqual([]);

    const adminImported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
      isPlatformAdmin: true,
      name: "Platform Restored Bot",
    });

    expect(
      (await db.listMcpServersForProfile(adminImported.profileId)).map(
        (server) => server.id
      )
    ).toEqual(["mcp_prod"]);

    const granted = await service.createProfile(DEST, { name: "Granted Host" });
    await db.assignMcpServerToProfile(granted.profile.id, "mcp_prod");

    const grantedImport = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
      name: "Granted Bot",
    });

    expect(
      (await db.listMcpServersForProfile(grantedImport.profileId)).map(
        (server) => server.id
      )
    ).toEqual(["mcp_prod"]);
  });

  test("guards: Super Bot, confirm, preview-only, and kind mismatch", async () => {
    const { db, service } = await setup();
    const normal = await service.createProfile(ORG, { name: "Bot" });

    const superBot = await service.createProfile(ORG, {
      isSuper: true,
      name: "Super Bot",
    });

    const exported = await createProfilePackExport(db, ORG, normal.profile.id);

    await expect(
      createProfilePackExport(db, ORG, superBot.profile.id)
    ).rejects.toThrow(/super bot cannot be exported/i);
    await expect(
      importProfilePack(db, DEST, exported.data, { confirm: false })
    ).rejects.toThrow(/confirmation is required/i);

    const before = (await db.listProfilesForOrg(DEST)).length;
    await previewProfilePackImport(db, DEST, exported.data);
    expect(await db.listProfilesForOrg(DEST)).toHaveLength(before);

    for (const handlerType of [null, 123, [], {}]) {
      const invalid = repack(exported.data, {
        "nakama-profile-export.json": JSON.stringify({
          ...exported.manifest,
          meta: {
            ...exported.manifest.meta,
            customTools: [
              {
                description: "Invalid tool",
                handlerConfig: {},
                handlerType,
                name: "invalid_tool",
              },
            ],
          },
        }),
      });

      await expect(
        previewProfilePackImport(db, DEST, invalid)
      ).rejects.toThrow();
    }

    expect(await db.listProfilesForOrg(DEST)).toHaveLength(before);

    await expect(
      previewNakamaDataImport(exported.data, { rootDir: root })
    ).rejects.toThrow(/missing nakama export manifest/i);
    const full = await createNakamaDataExport({ rootDir: root });
    await expect(previewProfilePackImport(db, DEST, full.data)).rejects.toThrow(
      /missing the nakama profile pack manifest/i
    );
  });

  test("failed import rolls back created skills and the profile", async () => {
    const { db, service } = await setup();

    const { profile } = await service.createProfile(ORG, {
      name: "Rollback Bot",
    });

    await writeSkill(db, ORG, profile.id, "rollback-skill");
    await db.upsertTool({
      createdAt: now(),
      description: "Boom",
      handlerConfig: {},
      handlerType: "builtin",
      id: "tool_boom",
      name: "boom-tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_boom");

    const exported = await createProfilePackExport(db, ORG, profile.id);
    const assignTool = db.assignToolToProfile.bind(db);
    db.assignToolToProfile = async () => {
      throw new Error("forced assignment failure");
    };

    await expect(
      importProfilePack(db, DEST, exported.data, { confirm: true })
    ).rejects.toThrow("forced assignment failure");
    db.assignToolToProfile = assignTool;

    expect(await db.getSkillByName("rollback-skill", DEST)).toBeNull();
    expect(
      (await db.listProfilesForOrg(DEST)).some((p) =>
        p.name.includes("Rollback")
      )
    ).toBe(false);
  });

  test("a pack carrying a skill-local tool.js is refused, not installed", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    const exported = await createProfilePackExport(db, ORG, profile.id);
    const marker = path.join(root, "pwned.txt");

    const crafted = repack(exported.data, {
      "skills/my-skill/tool.js": exfiltratingTool(marker),
    });

    await expect(previewProfilePackImport(db, DEST, crafted)).rejects.toThrow(
      /never installed from a profile pack/i
    );
    await expect(
      importProfilePack(db, DEST, crafted, { confirm: true })
    ).rejects.toThrow(/never installed from a profile pack/i);

    // The refusal happens before the profile row, so the org keeps no trace
    // of the attempt and the payload never reaches the filesystem.
    expect(await db.listProfilesForOrg(DEST)).toEqual([]);
    expect(
      await readdir(path.join(root, "orgs", DEST, "profiles")).catch(
        // SAFETY: The test fixture matches the contract used by this test.
        () => [] as string[]
      )
    ).toEqual([]);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });

  test("the tool.js refusal survives entry path spellings", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    const exported = await createProfilePackExport(db, ORG, profile.id);
    const marker = path.join(root, "pwned.txt");

    for (const entryPath of [
      "./skills/my-skill/tool.js",
      "skills/my-skill/./tool.js",
      "skills/my-skill/lib/tool.js",
      "skills/my-skill/Tool.JS",
      "skills/my-skill/tool.ts",
      "skills/my-skill/tool.mjs",
    ]) {
      const crafted = repack(exported.data, {
        [entryPath]: exfiltratingTool(marker),
      });

      await expect(
        importProfilePack(db, DEST, crafted, { confirm: true })
      ).rejects.toThrow(/never installed from a profile pack/i);
    }

    expect(await db.listProfilesForOrg(DEST)).toEqual([]);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });

  test("export drops in-process skill sources and imports the skill as prose", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    await writeFile(
      path.join(soul(ORG, profile.id), "skills", "my-skill", "tool.js"),
      "export async function run() {}\n",
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG, profile.id);
    const names = Object.keys(unzipSync(new Uint8Array(exported.data)));
    expect(names).toContain("skills/my-skill/SKILL.md");
    expect(names.some((name) => name.endsWith("tool.js"))).toBe(false);
    expect(
      exported.manifest.skipped.some(
        (item) =>
          item.path === "skills/my-skill/tool.js" &&
          item.reason.includes("server process")
      )
    ).toBe(true);

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });

    const [importedSkill] = await db.listSkillsForProfile(imported.profileId);
    expect(importedSkill?.name).toBe("my-skill");
    expect(importedSkill?.hasTool).toBe(false);
    await expect(
      readFile(
        path.join(
          soul(DEST, imported.profileId),
          "skills",
          "my-skill",
          "tool.js"
        ),
        "utf8"
      )
    ).rejects.toThrow();
  });

  test("a Python skill tool still travels in a pack", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Py Bot" });
    await writeSkill(db, ORG, profile.id, "py-skill");
    await writeFile(
      path.join(soul(ORG, profile.id), "skills", "py-skill", "tool.py"),
      '"""Docs."""\n\ndef run(input, context):\n    return {}\n',
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(Object.keys(unzipSync(new Uint8Array(exported.data)))).toContain(
      "skills/py-skill/tool.py"
    );
  });
});
