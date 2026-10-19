import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureBundledSkillFiles, type ToolDefinition } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import {
  createInMemoryDatabaseAdapter,
  mergeWorkspaceSettings,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

interface AgentServiceCodingContextAccess {
  formatCodingDelegationContext(
    orgId: string,
    profileId: string
  ): Promise<string>;
}

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

describe("AgentService coding delegation context", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(
      path.join(tmpdir(), "nakama-agent-delegation-bin-")
    );
    process.env.PATH = tempBinDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;

    if (originalDisableFixPath === undefined) {
      delete process.env.NAKAMA_DISABLE_FIX_PATH;
    } else {
      process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
    }

    if (tempBinDir) {
      await rm(tempBinDir, { force: true, recursive: true });
      tempBinDir = "";
    }
  });

  test("includes harness command template and backend guidance for bash delegation", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await installFakeOpenCode(tempBinDir);
    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [
          {
            args: [],
            command: "opencode",
            enabled: true,
            id: "coding-harness-opencode",
            kind: "opencode",
            name: "OpenCode",
          },
        ],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("bash");
    expect(context).toContain("opencode run");
    expect(context).not.toContain("delegate_coding_task");
    expect(context).not.toContain("workspace settings");
  });

  test("lists install commands when no coding agent CLI is installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("No coding agent CLI is installed");
    expect(context).toContain("npm install -g");
    expect(context).toContain("Cursor Agent CLI");
    expect(context).toContain("cannot be auto-installed");
    expect(context).not.toContain("workspace settings");
    expect(context).not.toContain("delegate_coding_task");
  });

  test("asks the user when multiple coding agent CLIs are installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await installFakeOpenCode(tempBinDir);
    await Bun.write(
      path.join(
        tempBinDir,
        process.platform === "win32" ? "claude.cmd" : "claude"
      ),
      process.platform === "win32"
        ? "@echo off\r\necho claude\r\n"
        : "#!/bin/sh\necho claude\n"
    );
    await chmod(
      path.join(
        tempBinDir,
        process.platform === "win32" ? "claude.cmd" : "claude"
      ),
      0o755
    );

    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [
          {
            args: [],
            command: "opencode",
            enabled: true,
            id: "coding-harness-opencode",
            kind: "opencode",
            name: "OpenCode",
          },
          {
            args: [],
            command: "claude",
            enabled: true,
            id: "coding-harness-claude-code",
            kind: "claude_code",
            name: "Claude Code",
          },
        ],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: "coding-harness-opencode",
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("Multiple coding agent CLIs are installed");
    expect(context).toContain("Ask the user which one to use");
    expect(context).toContain("OpenCode");
    expect(context).toContain("Claude Code");
    expect(context).not.toContain("opencode run");
  });
});

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

    const session = await service.resolveSession(sessionId, ORG_ID);
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

    const session = await service.resolveSession(sessionId, ORG_ID);
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

    const session = await service.resolveSession(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    await session!.send({ message: "/learn" });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe("/learn");
  });
});

async function installFakeOpenCode(binDir: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(
      path.join(binDir, "opencode.cmd"),
      "@echo off\r\necho fake opencode\r\n"
    );

    return;
  }

  const scriptPath = path.join(binDir, "opencode");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "fake opencode"',
      "  exit 0",
      "fi",
      "printf '%s' \"$*\"",
    ].join("\n")
  );
  await chmod(scriptPath, 0o755);
}
