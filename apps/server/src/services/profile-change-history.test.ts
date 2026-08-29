import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createInMemoryDatabaseAdapter,
  ensureBuiltinToolDefinitions,
} from "@nakama/db";
import { ProfileService } from "./profile-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const ORG_ID = "org_history_test";

describe("profile change history", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("records append-only dashboard updates for system prompt and tools", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-pch-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    await db.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG_ID,
      name: "History Org",
      slug: "history-org",
      updatedAt: new Date().toISOString(),
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, {
      name: "History Bot",
      systemPrompt: "before",
    });
    const profileId = created.profile.id;

    await service.updateProfile(
      ORG_ID,
      profileId,
      { systemPrompt: "after" },
      { actorUserId: "user_admin", source: "dashboard" }
    );

    const tools = await db.listToolsForProfile(profileId);
    const toolId = tools[0]!.id;
    await service.unassignTool(ORG_ID, profileId, toolId, {
      actorUserId: "user_admin",
      source: "dashboard",
    });

    const history = await service.listProfileChangeHistory(ORG_ID, profileId);
    expect(history.events.length).toBeGreaterThanOrEqual(2);

    const promptEvent = history.events.find(
      (event) => event.field === "system_prompt"
    );
    expect(promptEvent).toMatchObject({
      actorUserId: "user_admin",
      afterValue: "after",
      beforeValue: "before",
      source: "dashboard",
    });

    const toolsEvent = history.events.find((event) => event.field === "tools");
    expect(toolsEvent?.source).toBe("dashboard");
    expect(toolsEvent?.beforeValue).toContain(toolId);
    expect(toolsEvent?.afterValue).not.toContain(toolId);

    const firstId = history.events[0]!.id;
    const again = await service.listProfileChangeHistory(ORG_ID, profileId);
    expect(again.events.map((event) => event.id)).toContain(firstId);
    expect(again.events).toHaveLength(history.events.length);
  });

  test("records super_bot and pack_import sources", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-pch-src-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    await db.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG_ID,
      name: "History Org",
      slug: "history-org-2",
      updatedAt: new Date().toISOString(),
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, {
      name: "Source Bot",
      systemPrompt: "v1",
    });

    await service.updateProfile(
      ORG_ID,
      created.profile.id,
      {
        soulFiles: { "SOUL.md": "# soul after" },
        systemPrompt: "v2",
      },
      { actorUserId: "user_chat", source: "super_bot" }
    );

    const history = await service.listProfileChangeHistory(
      ORG_ID,
      created.profile.id
    );
    expect(
      history.events.some(
        (event) =>
          event.source === "super_bot" && event.field === "system_prompt"
      )
    ).toBe(true);
    expect(
      history.events.some(
        (event) => event.source === "super_bot" && event.field === "soul.soul"
      )
    ).toBe(true);
  });
});
