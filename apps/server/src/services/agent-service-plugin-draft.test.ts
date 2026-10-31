import { describe, expect, test } from "bun:test";
import { ensureBundledSkillFiles } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type StoredProfileRecord,
} from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { SkillsService } from "./skills-service";

/** The private resolver that decides which tools a chat turn gets. */
interface ProfileToolResolver {
  resolveProfileTools(
    profile: StoredProfileRecord,
    kind: "chat",
    options: { channel: "web" }
  ): Promise<Array<{ name: string }>>;
}

describe("submit_plugin_draft on an ordinary agent", () => {
  setupTestConfigDir("nakama-plugin-draft-");

  test("arrives with create-plugin and brings no other Super tool", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = createDefaultProfile();
    await db.upsertProfile(profile);

    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    // SAFETY: resolveProfileTools is private; only tool names are read.
    const resolver = Object.create(service) as ProfileToolResolver;

    const names = async () =>
      (
        await resolver.resolveProfileTools(profile, "chat", { channel: "web" })
      ).map((tool) => tool.name);

    expect(await names()).not.toContain("submit_plugin_draft");

    const createPlugin = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "create-plugin"
    );

    await db.assignSkillToProfile(profile.id, createPlugin!.id);

    const granted = await names();
    expect(granted).toContain("submit_plugin_draft");
    expect(granted).not.toContain("create_profile");
  });
});
