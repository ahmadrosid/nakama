import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentChannel,
  ensureBundledSkillFiles,
  type ToolDefinition,
} from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

import { SkillsService } from "./skills-service";
import type { TurnKind } from "./turn-kinds";

const ORG_ID = "org_test";

interface AgentServiceProfileToolsAccess {
  resolveProfileTools(
    profile: StoredProfileRecord,
    kind: TurnKind,
    options?: { channel?: AgentChannel }
  ): Promise<Array<{ name: string }>>;
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("AgentService skill_manage injection", () => {
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(
      path.join(tmpdir(), "nakama-skill-manage-inject-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  test.each(["manage-skills", "skill-installer"])(
    "injects skill_manage for interactive chat when %s is assigned",
    async (skillName) => {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertProfile(createDefaultProfile());
      // Give the profile at least one own tool so the platform groups (incl.
      // skill_manage) are eligible; the no-tools case is covered separately.
      await db.upsertTool({
        createdAt: new Date().toISOString(),
        description: "Test tool",
        handlerConfig: { modulePath: "test.js" },
        handlerType: "javascript",
        id: "tool_for_skill_manage",
        name: "test_tool",
        updatedAt: new Date().toISOString(),
      });
      await db.assignToolToProfile("profile_default", "tool_for_skill_manage");
      const skills = new SkillsService(db);
      await ensureBundledSkillFiles();
      await skills.syncDiscoveredSkills();

      const manage = (await skills.listSkills()).skills.find(
        (skill) => skill.name === skillName
      );

      expect(manage).toBeDefined();
      await db.assignSkillToProfile("profile_default", manage!.id);

      const service = new AgentService(null, null, db);
      service.setSkillsService(skills);

      // SAFETY: This test checks the profile tool resolver for its fixture.
      const resolve =
        privateServiceAccess<AgentServiceProfileToolsAccess>(
          service
        ).resolveProfileTools.bind(service);

      const profile = createDefaultProfile();

      const hasSkillManage = async (kind: TurnKind, channel?: AgentChannel) =>
        (await resolve(profile, kind, { channel })).some(
          (tool) => tool.name === "skill_manage"
        );

      expect(await hasSkillManage("chat", "web")).toBe(true);
      expect(await hasSkillManage("chat", "telegram")).toBe(false);
      expect(await hasSkillManage("cognito", "web")).toBe(false);
      expect(await hasSkillManage("automation")).toBe(false);
      expect(await hasSkillManage("plugin_workflow")).toBe(false);
      // The ACP draft list is built before any channel exists.
      expect(await hasSkillManage("acp_draft")).toBe(true);
    }
  );

  test("each turn kind gets its own platform tools", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_for_turn_kinds",
      name: "test_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile("profile_default", "tool_for_turn_kinds");

    const service = new AgentService(null, null, db);
    service.setAutomationTools([
      // SAFETY: This test controls the fixture shape at this boundary.
      { name: "create_automation" } as ToolDefinition,
    ]);

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const names = async (kind: TurnKind) =>
      (await resolve(createDefaultProfile(), kind, { channel: "web" })).map(
        (tool) => tool.name
      );

    const planning = ["create_automation", "todo_write", "ask_user_question"];

    expect(await names("chat")).toEqual(expect.arrayContaining(planning));
    expect(await names("chat")).toContain("propose_org_memory");

    // A child chat runs unwatched, like the in-memory sub-agent.
    for (const kind of ["child", "sub_agent", "group_member"] as const) {
      const tools = await names(kind);

      for (const name of planning) {
        expect(tools).not.toContain(name);
      }
    }

    // Nothing leaves a cognito chat.
    expect(await names("cognito")).not.toContain("propose_org_memory");
    expect(await names("cognito")).toContain("todo_write");

    // Nobody is there to answer, and the question would end the run.
    expect(await names("automation")).not.toContain("ask_user_question");
    expect(await names("automation")).not.toContain("todo_write");
    expect(await names("automation")).not.toContain("create_automation");

    expect(await names("plugin_summarize")).toEqual([]);

    expect(await names("branch")).toEqual(await names("chat"));

    expect(await names("acp_draft")).toEqual(expect.arrayContaining(planning));
    expect(await names("acp_draft")).toContain("propose_org_memory");

    const workflow = await names("plugin_workflow");
    expect(workflow).not.toContain("ask_user_question");
    expect(workflow).not.toContain("todo_write");
    expect(workflow).not.toContain("create_automation");
  });

  test("skips platform tool groups for a profile with no tools", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const profile = createDefaultProfile();

    // Profile with zero own tools: no platform groups, no session helpers.
    const tools = await resolve(profile, "chat", { channel: "web" });

    expect(tools).toHaveLength(0);

    // Give the profile one own tool; platform groups come back.
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_for_platform_groups",
      name: "test_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile("profile_default", "tool_for_platform_groups");

    const withTools = await resolve(profile, "chat", { channel: "web" });

    expect(withTools.some((tool) => tool.name === "test_tool")).toBe(true);
    expect(withTools.some((tool) => tool.name === "ask_user_question")).toBe(
      true
    );
    expect(withTools.some((tool) => tool.name === "todo_write")).toBe(true);
  });

  test("keeps automation tools for a disabled profile so it can create its first automation", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      automationsEnabled: false,
    };

    await db.upsertProfile(profile);
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_for_automation_gate",
      name: "test_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile(profile.id, "tool_for_automation_gate");

    const service = new AgentService(null, null, db);
    service.setAutomationTools([
      // SAFETY: This test controls the fixture shape at this boundary.
      { name: "create_automation" } as ToolDefinition,
    ]);

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const tools = await resolve(profile, "chat", { channel: "web" });
    expect(tools.some((tool) => tool.name === "create_automation")).toBe(true);
  });

  test("keeps raw /learn in history on web when manage-skills is assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.sessions.get(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    const typed = "/learn filing an expense: open portal, submit receipt";
    await session!.send({ message: typed });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe(typed);
  });

  test("does not expand /learn on telegram even with manage-skills assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "telegram",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.sessions.get(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    await session!.send({
      message: "/learn filing an expense",
    });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe("/learn filing an expense");
  });

  test("keeps bare /learn raw in history on cli", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "cli",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.sessions.get(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    await session!.send({ message: "/learn" });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe("/learn");
  });
});
