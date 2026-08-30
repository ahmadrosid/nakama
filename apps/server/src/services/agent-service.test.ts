import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureBundledSkillFiles,
  loadDiscordConfigFile,
  loadTelegramConfigFile,
} from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { AgentService } from "./agent-service";
import { sessionTurnRegistry } from "./session-turn-registry";
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
  test("keeps model selection scoped to the chat session", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      model: "provider-1::profile-default",
    });
    const service = new AgentService(
      {
        defaultProviderId: "provider-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "profile-default" },
              { id: "chat-model" },
              { id: "next-chat-model" },
            ],
            id: "provider-1",
            label: "Test provider",
            type: "openai_compatible",
          },
        ],
      },
      null,
      db
    );

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { model: "provider-1::chat-model" }
    );

    expect((await db.getProfile("profile_default"))?.model).toBe(
      "provider-1::profile-default"
    );
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );
    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "provider-1::chat-model"
    );

    sessionTurnRegistry.beginTurn(sessionId);
    await expect(
      service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).rejects.toThrow("Wait for the current response");
    sessionTurnRegistry.cancelTurn(sessionId);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );

    expect(
      await service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).toBe(true);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await expect(
      service.updateSessionModel(sessionId, ORG_ID, "provider-1::unknown")
    ).rejects.toThrow("Select a configured model");
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await db.replaceMessagesForSession(sessionId, [
      {
        createdAt: "2026-08-25T00:00:00.000Z",
        id: "msg_session_model",
        payload: { content: "Keep the chat model", role: "user" },
        seq: 0,
        sessionId,
      },
    ]);

    const branch = await service.branchSession(sessionId, 0, ORG_ID);
    expect(branch).not.toBeNull();
    expect((await db.getSession(branch!.sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );

    expect(await service.updateSessionModel(sessionId, ORG_ID, null)).toBe(
      true
    );
    expect((await db.getSession(sessionId))?.model).toBeNull();
  });

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

describe("AgentService bot token validation", () => {
  const originalFetch = globalThis.fetch;
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-bot-token-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  test("rejects and does not persist a Telegram token rejected by Telegram", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    }) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setTelegramSettings({ botToken })
    );
    const configured = (await service.getTelegramSettings()).configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadTelegramConfigFile()).toBeNull();
  });

  for (const failure of [
    {
      fetch: async () => new Response("not-json", { status: 200 }),
      name: "a malformed response",
    },
    {
      fetch: async () => {
        throw new Error("network failure");
      },
      name: "a network failure",
    },
  ]) {
    test(`does not persist a Telegram token after ${failure.name}`, async () => {
      globalThis.fetch = failure.fetch as typeof fetch;
      const botToken = "123456:unvalidated-token";
      const service = new AgentService(
        null,
        null,
        createInMemoryDatabaseAdapter()
      );

      const error = await captureError(() =>
        service.setTelegramSettings({ botToken })
      );

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).not.toContain(botToken);
      expect(await loadTelegramConfigFile()).toBeNull();
    });
  }

  test("persists a Telegram token accepted by Telegram", async () => {
    let requestUrl = "";
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(
        JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    }) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setTelegramSettings({
      botToken: "123456:valid-token",
    });

    expect(saved.configured).toBe(true);
    expect(new URL(requestUrl).pathname).toBe("/bot123456%3Avalid-token/getMe");
    expect((await service.getTelegramSettings()).configured).toBe(true);
  });

  test("rejects and does not persist a Discord token rejected by Discord", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(null, { status: 401 });
    }) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setDiscordSettings({ botToken })
    );
    const configured = (await service.getDiscordSettings()).configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadDiscordConfigFile()).toBeNull();
  });

  for (const failure of [
    {
      fetch: async () =>
        new Response(JSON.stringify({ id: "not-a-snowflake" }), {
          status: 200,
        }),
      name: "a malformed response",
    },
    {
      fetch: async () => {
        throw new Error("network failure");
      },
      name: "a network failure",
    },
  ]) {
    test(`does not persist a Discord token after ${failure.name}`, async () => {
      globalThis.fetch = failure.fetch as typeof fetch;
      const botToken = "unvalidated-discord-token";
      const service = new AgentService(
        null,
        null,
        createInMemoryDatabaseAdapter()
      );

      const error = await captureError(() =>
        service.setDiscordSettings({ botToken })
      );

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).not.toContain(botToken);
      expect(await loadDiscordConfigFile()).toBeNull();
    });
  }

  test("persists a Discord token accepted by Discord", async () => {
    let authorization = "";
    let requestCount = 0;
    globalThis.fetch = (async (_input, init) => {
      requestCount += 1;
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(JSON.stringify({ id: "1525937133096013954" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setDiscordSettings({
      botToken: "valid-discord-token",
    });

    expect(saved.configured).toBe(true);
    expect(authorization).toBe("Bot valid-discord-token");
    expect((await service.getDiscordSettings()).configured).toBe(true);
    expect(requestCount).toBe(1);
  });

  test("preserves Telegram config after a rejected replacement and on token-less edits", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
        { status: 200 }
      )) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );
    await service.setTelegramSettings({
      allowedUserIds: "42",
      botToken: "123456:original-token",
      profileId: "original",
    });
    const beforeReplacement = await loadTelegramConfigFile();

    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as typeof fetch;
    await expect(
      service.setTelegramSettings({
        allowedUserIds: "43",
        botToken: "123456:rejected-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await loadTelegramConfigFile()).toEqual(beforeReplacement);

    globalThis.fetch = (async () => {
      throw new Error("Token-less Telegram edits must not call the provider.");
    }) as typeof fetch;
    await service.setTelegramSettings({
      allowedUserIds: "43",
      profileId: "edited",
    });
    expect(await loadTelegramConfigFile()).toMatchObject({
      allowedUserIds: [43],
      botToken: "123456:original-token",
      profileId: "edited",
    });
  });

  test("revalidates a cached Discord token and preserves config when rejected", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "1525937133096013954" }), {
        status: 200,
      })) as typeof fetch;
    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );
    await service.setDiscordSettings({
      allowedUserIds: "123456789012345678",
      botToken: "cached-discord-token",
      profileId: "original",
    });
    const beforeReplacement = await loadDiscordConfigFile();
    let rejectedRequestCount = 0;

    globalThis.fetch = (async () => {
      rejectedRequestCount += 1;
      return new Response(null, { status: 401 });
    }) as typeof fetch;
    await expect(
      service.setDiscordSettings({
        allowedUserIds: "987654321098765432",
        botToken: "cached-discord-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(rejectedRequestCount).toBe(1);
    expect(await loadDiscordConfigFile()).toEqual(beforeReplacement);

    await service.setDiscordSettings({
      allowedUserIds: "987654321098765432",
      profileId: "edited",
    });
    expect(await loadDiscordConfigFile()).toMatchObject({
      allowedUserIds: ["987654321098765432"],
      botToken: "cached-discord-token",
      profileId: "edited",
    });
  });

  test("returns credential-safe HTTP errors without creating channel configs", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const service = new AgentService(null, null, databaseAdapter);
    const { app } = createMinimalHonoApp({ agent: service, databaseAdapter });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as typeof fetch;

    for (const channel of ["telegram", "discord"] as const) {
      const botToken = `rejected-${channel}-token`;
      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/settings/${channel}`, {
          body: JSON.stringify({ botToken }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "PUT",
        })
      );
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).not.toContain(botToken);
    }

    expect(await loadTelegramConfigFile()).toBeNull();
    expect(await loadDiscordConfigFile()).toBeNull();
  });
});

async function captureError(
  run: () => Promise<unknown>
): Promise<Error | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

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
