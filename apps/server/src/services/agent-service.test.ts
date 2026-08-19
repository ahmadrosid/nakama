import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureBundledSkillFiles } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import { AgentService } from "./agent-service";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    id: "profile_default",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default",
    orgId: ORG_ID,
    systemPrompt: "You are helpful.",
    updatedAt: now,
  };
}

describe("AgentService branching", () => {
  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:01.000Z",
        id: "msg_2",
        payload: { content: "Hi there", role: "assistant" },
        seq: 1,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:02.000Z",
        id: "msg_3",
        payload: { content: "Second turn", role: "user" },
        seq: 2,
        sessionId: sourceSessionId,
      },
    ]);
    await db.updateSessionTitle(sourceSessionId, "Original chat");
    await db.updateSessionTodos(sourceSessionId, [
      {
        content: "Keep this out of the branch",
        id: "todo_1",
        status: "pending",
      },
    ]);
    await db.updateSessionQuestionnaire(sourceSessionId, {
      id: "q_1",
      questions: [
        {
          allowCustomAnswer: true,
          choices: [],
          id: "timeline",
          prompt: "When?",
        },
      ],
      title: "Need input",
    });

    const result = await service.branchSession(sourceSessionId, 1, ORG_ID);

    expect(result).not.toBeNull();
    const branchSessionId = result!.sessionId;

    const branchMessages = await service.getSessionMessages(
      branchSessionId,
      ORG_ID
    );
    expect(branchMessages?.messages).toEqual([
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ]);
    expect(branchMessages?.messageMeta).toHaveLength(2);

    const branchTodos = await service.getSessionTodos(branchSessionId, ORG_ID);
    expect(branchTodos).toEqual([]);
    expect(
      await service.getSessionQuestionnaire(branchSessionId, ORG_ID)
    ).toBeNull();

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe("profile_default");
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");

    const sourceMessages = await service.getSessionMessages(
      sourceSessionId,
      ORG_ID
    );
    expect(sourceMessages?.messages).toHaveLength(3);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
    ]);

    await expect(
      service.branchSession(sourceSessionId, 3, ORG_ID)
    ).rejects.toThrow("messageIndex is out of bounds.");
  });

  test("falls back to org default when the requested profile is missing", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertOrganization({
        createdAt: now,
        id: ORG_ID,
        name: "Test Org",
        slug: "test-org",
        updatedAt: now,
      });

      await db.upsertProfile({
        createdAt: now,
        id: "profile_custom",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Custom",
        orgId: ORG_ID,
        systemPrompt: "You are helpful.",
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      const sessionId = await service.createSession(
        ORG_ID,
        "web",
        "missing_profile"
      );
      const session = await db.getSession(sessionId);

      expect(session?.profileId).toBe("profile_custom");
    } finally {
      database.close();
    }
  });
});

describe("AgentService session org scope", () => {
  test("by-id reads return null for a session in another org", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: "profile_other",
      isDefault: false,
      name: "Other",
      orgId: "org_other",
    });
    const service = new AgentService(null, null, db);
    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    expect(await service.getSessionMessages(sessionId, "org_other")).toBeNull();
    expect(await service.resolveSession(sessionId, "org_other")).toBeNull();
    expect(await service.purgeSession(sessionId, "org_other")).toBe(false);
    expect(await db.getSession(sessionId)).not.toBeNull();
  });
});

describe("AgentService thinking provider options", () => {
  test("keeps thinking enabled for openai-compatible providers", () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "compat-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "qwen3.6-35b", supportsThinking: true },
            ],
            id: "compat-1",
            label: "NetraRuntime",
            type: "openai_compatible",
          },
        ],
        thinkingEffort: "high",
        thinkingEnabled: true,
      },
      null,
      db
    );

    const options = (
      service as unknown as {
        resolveChatProviderOptions: (
          providerInstance: {
            type: "openai_compatible";
            id: string;
            label: string;
            apiKey: string;
            baseUrl: string;
            createdAt: string;
          },
          thinkingSettings: {
            enabled: boolean;
            effort: "low" | "medium" | "high";
          }
        ) => { thinking?: { enabled: boolean; effort: string } } | undefined;
      }
    ).resolveChatProviderOptions(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        createdAt: new Date().toISOString(),
        id: "compat-1",
        label: "NetraRuntime",
        type: "openai_compatible",
      },
      { effort: "high", enabled: true }
    );

    expect(options?.thinking).toEqual({ effort: "high", enabled: true });
  });
});

describe("AgentService vision settings", () => {
  test("persists vision model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setVisionSettings({
      model: "p-openai-1::gpt-4o-mini",
    });

    expect(saved).toEqual({ vision: { model: "p-openai-1::gpt-4o-mini" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: null,
      visionModel: "p-openai-1::gpt-4o-mini",
    });
    expect(await service.getVisionSettings()).toEqual({
      vision: { model: "p-openai-1::gpt-4o-mini" },
    });
  });

  test("does not reset coding-agent passthrough when vision is saved", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [],
      codingAgentProviderPassthrough: false,
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    await service.setVisionSettings({ model: "p-openai-1::gpt-4o-mini" });

    expect(await db.getWorkspaceSettings()).toMatchObject({
      codingAgentProviderPassthrough: false,
      visionModel: "p-openai-1::gpt-4o-mini",
    });
  });
});

describe("AgentService transcription settings", () => {
  test("persists transcription model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setTranscriptionSettings({
      model: "p-openai-1::whisper-1",
    });

    expect(saved).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: "p-openai-1::whisper-1",
    });
    expect(await service.getTranscriptionSettings()).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
  });

  test("does not reset coding-agent passthrough when transcription is saved", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [],
      codingAgentProviderPassthrough: false,
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    await service.setTranscriptionSettings({
      model: "p-openai-1::whisper-1",
    });

    expect(await db.getWorkspaceSettings()).toMatchObject({
      codingAgentProviderPassthrough: false,
      transcriptionModel: "p-openai-1::whisper-1",
    });
  });
});

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
    await installFakeOpenCode(tempBinDir);
    await db.upsertWorkspaceSettings({
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
    });

    const service = new AgentService(null, null, db);
    const context = await (
      service as unknown as {
        formatCodingDelegationContext(
          orgId: string,
          profileId: string
        ): Promise<string>;
      }
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("bash");
    expect(context).toContain("opencode run");
    expect(context).not.toContain("delegate_coding_task");
    expect(context).not.toContain("workspace settings");
  });

  test("lists install commands when no coding agent CLI is installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });

    const service = new AgentService(null, null, db);
    const context = await (
      service as unknown as {
        formatCodingDelegationContext(
          orgId: string,
          profileId: string
        ): Promise<string>;
      }
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
    await installFakeOpenCode(tempBinDir);
    await Bun.write(
      path.join(tempBinDir, "claude"),
      "#!/bin/sh\necho claude\n"
    );
    await chmod(path.join(tempBinDir, "claude"), 0o755);

    await db.upsertWorkspaceSettings({
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
    });

    const service = new AgentService(null, null, db);
    const context = await (
      service as unknown as {
        formatCodingDelegationContext(
          orgId: string,
          profileId: string
        ): Promise<string>;
      }
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

  test("injects skill_manage for web/cli only when manage-skills is assigned", async () => {
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

    type ResolveTools = {
      resolveProfileTools(
        profile: StoredProfileRecord,
        options?: {
          includeAutomationTools?: boolean;
          includeSkillManageTools?: boolean;
        }
      ): Promise<Array<{ name: string }>>;
    };

    const resolve = (
      service as unknown as ResolveTools
    ).resolveProfileTools.bind(service);
    const profile = createDefaultProfile();

    const webTools = await resolve(profile, { includeSkillManageTools: true });
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
