import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureBundledSkillFiles, type ToolDefinition } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

interface AgentServiceProfileToolsAccess {
  resolveProfileTools(
    profile: StoredProfileRecord,
    options?: {
      includeAutomationTools?: boolean;
      includeQuestionTools?: boolean;
      includeSkillManageTools?: boolean;
      includeTodoTools?: boolean;
    }
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

      type ResolveTools = {
        resolveProfileTools(
          profile: StoredProfileRecord,
          options?: {
            includeAutomationTools?: boolean;
            includeSkillManageTools?: boolean;
          }
        ): Promise<Array<{ name: string }>>;
      };

      // SAFETY: This test checks the profile tool resolver for its fixture.
      const resolve =
        privateServiceAccess<AgentServiceProfileToolsAccess>(
          service
        ).resolveProfileTools.bind(service);

      const profile = createDefaultProfile();

      const webTools = await resolve(profile, {
        includeSkillManageTools: true,
      });

      expect(webTools.some((tool) => tool.name === "skill_manage")).toBe(true);

      const telegramTools = await resolve(profile, {
        includeSkillManageTools: false,
      });

      expect(telegramTools.some((tool) => tool.name === "skill_manage")).toBe(
        false
      );

      const automationTools = await resolve(profile, {
        includeAutomationTools: false,
      });

      expect(automationTools.some((tool) => tool.name === "skill_manage")).toBe(
        false
      );
    }
  );

  test("skips platform tool groups for a profile with no tools", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    type ResolveTools = {
      resolveProfileTools(
        profile: StoredProfileRecord,
        options?: {
          includeAutomationTools?: boolean;
          includeSkillManageTools?: boolean;
          includeTodoTools?: boolean;
          includeQuestionTools?: boolean;
        }
      ): Promise<Array<{ name: string }>>;
    };

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const profile = createDefaultProfile();

    // Profile with zero own tools: no platform groups, no session helpers.
    const tools = await resolve(profile, {
      includeAutomationTools: true,
      includeQuestionTools: true,
      includeSkillManageTools: true,
      includeTodoTools: true,
    });

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

    const withTools = await resolve(profile, {
      includeAutomationTools: true,
      includeQuestionTools: true,
      includeSkillManageTools: true,
      includeTodoTools: true,
    });

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

    type ResolveTools = {
      resolveProfileTools(
        profile: StoredProfileRecord,
        options?: { includeAutomationTools?: boolean }
      ): Promise<Array<{ name: string }>>;
    };

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const tools = await resolve(profile, { includeAutomationTools: true });
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
