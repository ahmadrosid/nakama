import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  derivePluginToolName,
  PLUGIN_MANIFEST_API_VERSION,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
} from "@nakama/db";
import { zipSync } from "fflate";
import { AgentService } from "./agent-service";
import { PluginService } from "./plugin-service";
import { SkillsService } from "./skills-service";
import {
  pluginActorFromContext,
  resolveProfileStoredTools,
} from "./tool-resolver";

const ORG_ID = "org_u5_agent";

const ACTION_JS = `
export async function run(_input, context) {
  return { actor: context.actor, orgId: context.orgId };
}
`;

function encodeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = Buffer.from(value);
  }
  return zipSync(entries);
}

function bundle(): Uint8Array {
  return encodeZip({
    "actions/write.js": ACTION_JS,
    "nakama.plugin.json": JSON.stringify({
      actions: [
        {
          access: "member",
          description: "Write a note",
          effect: "write",
          entry: "actions/write.js",
          exposeAsTool: true,
          inputSchema: { type: "object" },
          key: "write",
        },
      ],
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      author: "Nakama",
      description: "Notes plugin",
      id: "notes",
      license: "MIT",
      minNakamaVersion: "0.1.0",
      name: "Notes",
      skills: [{ directory: "skills/notes", key: "notes" }],
      version: "1.0.0",
    }),
    "skills/notes/SKILL.md": `---
name: notes
description: Capture notes. Use when the user asks about notes.
---

Plugin notes skill.
`,
  });
}

describe("AgentService plugin capabilities", () => {
  let configDir = "";
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-agent-u5-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
    await rm(configDir, { force: true, recursive: true });
  });

  test("turn-boundary resolve rebuilds when plugin revision changes and keeps assignments", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);
    const skills = new SkillsService(db);
    skills.setPluginService(plugins);
    const agent = new AgentService(null, null, db);
    agent.setPluginService(plugins);
    agent.setSkillsService(skills);

    await plugins.installPluginPackage(bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    const enabled = await plugins.enableOrgPlugin(
      ORG_ID,
      "notes",
      added.revision
    );
    const skill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignSkillToProfile(profile.id, skill!.id);
    await db.assignToolToProfile(profile.id, tool!.id);

    const sessionId = await agent.createSession(ORG_ID, "web", profile.id);
    const first = await agent.resolveSession(sessionId, ORG_ID);
    const again = await agent.resolveSession(sessionId, ORG_ID);
    expect(again).toBe(first);

    const before = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    expect(
      before.some(
        (item) => item.name === derivePluginToolName("notes", "write")
      )
    ).toBe(true);

    await plugins.disableOrgPlugin(ORG_ID, "notes", enabled.revision);
    const started = await agent.beginSessionTurn(sessionId, ORG_ID);
    expect(started).toBe(true);
    const next = await agent.resolveSession(sessionId, ORG_ID);
    expect(next).not.toBe(first);

    const after = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    expect(
      after.some((item) => item.name === derivePluginToolName("notes", "write"))
    ).toBe(false);
    expect(
      (await db.listToolsForProfile(profile.id)).some(
        (row) => row.id === tool!.id
      )
    ).toBe(true);
    expect(
      (await db.listSkillsForProfile(profile.id)).some(
        (row) => row.id === skill!.id
      )
    ).toBe(true);
    expect(
      await skills.composeCatalogForProfile(ORG_ID, profile.id)
    ).not.toContain("Plugin notes skill");
  });

  test("web, automation, and sub-agent contexts keep org/profile/actor without Super Bot elevation", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    await db.upsertProfile({ ...profile, isSuper: true });
    const plugins = new PluginService(db, configDir);
    const agent = new AgentService(null, null, db);
    agent.setPluginService(plugins);

    await plugins.installPluginPackage(bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision);
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignToolToProfile(profile.id, tool!.id);

    const resolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    const pluginTool = resolved.find(
      (item) => item.name === derivePluginToolName("notes", "write")
    );
    expect(pluginTool).toBeDefined();

    const web = (await pluginTool!.run(
      {},
      {
        channel: "web",
        isPlatformAdmin: true,
        orgId: ORG_ID,
        orgRole: "member",
        profileId: profile.id,
        userId: "member_web",
      }
    )) as { actor: { id: string; role: string } };
    expect(web.actor).toEqual({ id: "member_web", role: "member" });

    const automation = (await pluginTool!.run(
      {},
      {
        channel: "automation",
        orgId: ORG_ID,
        orgRole: "member",
        profileId: profile.id,
        userId: undefined,
      }
    )) as { actor: { id: string; role: string } };
    expect(automation.actor.role).toBe("member");

    const messaging = (await pluginTool!.run(
      {},
      {
        channel: "telegram",
        isPlatformAdmin: true,
        orgId: ORG_ID,
        orgRole: "admin",
        profileId: profile.id,
        userId: "telegram_user",
      }
    )) as { actor: { id: string; role: string } };
    expect(messaging.actor).toEqual({ id: "telegram_user", role: "member" });

    expect(
      pluginActorFromContext({
        channel: "telegram",
        isPlatformAdmin: true,
        orgId: ORG_ID,
        orgRole: "admin",
        profileId: profile.id,
        userId: "telegram_user",
      })
    ).toEqual({ id: "telegram_user", role: "member" });

    expect(
      pluginActorFromContext({
        isPlatformAdmin: true,
        orgId: ORG_ID,
        orgRole: "member",
        profileId: profile.id,
        userId: "sub_user",
      })
    ).toEqual({ id: "sub_user", role: "member" });

    const child = await agent.runSubAgentPrompt({
      agentDepth: 1,
      orgId: ORG_ID,
      orgRole: "member",
      profileId: profile.id,
      task: "noop",
      userId: "sub_user",
    });
    expect(child.status).toBe("fail");
    expect(child.error).toContain("Provider is not configured");
  });
});
