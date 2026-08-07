import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureBundledSkillFiles } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import type { StoredProfileRecord } from "@nakama/db";
import { AgentService } from "./agent-service";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    id: "profile_default",
    name: "Default",
    systemPrompt: "You are helpful.",
    model: null,
    isSuper: false,
    orgId: ORG_ID,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AgentService branching", () => {
  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(ORG_ID, "web", "profile_default");
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        id: "msg_1",
        sessionId: sourceSessionId,
        seq: 0,
        payload: { role: "user", content: "Hello" },
        createdAt: "2026-06-14T10:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: sourceSessionId,
        seq: 1,
        payload: { role: "assistant", content: "Hi there" },
        createdAt: "2026-06-14T10:00:01.000Z",
      },
      {
        id: "msg_3",
        sessionId: sourceSessionId,
        seq: 2,
        payload: { role: "user", content: "Second turn" },
        createdAt: "2026-06-14T10:00:02.000Z",
      },
    ]);
    await db.updateSessionTitle(sourceSessionId, "Original chat");
    await db.updateSessionTodos(sourceSessionId, [
      { id: "todo_1", content: "Keep this out of the branch", status: "pending" },
    ]);
    await db.updateSessionQuestionnaire(sourceSessionId, {
      id: "q_1",
      title: "Need input",
      questions: [
        {
          id: "timeline",
          prompt: "When?",
          allowCustomAnswer: true,
          choices: [],
        },
      ],
    });

    const result = await service.branchSession(sourceSessionId, 1);

    expect(result).not.toBeNull();
    const branchSessionId = result!.sessionId;

    const branchMessages = await service.getSessionMessages(branchSessionId);
    expect(branchMessages?.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    expect(branchMessages?.messageMeta).toHaveLength(2);

    const branchTodos = await service.getSessionTodos(branchSessionId);
    expect(branchTodos).toEqual([]);
    expect(await service.getSessionQuestionnaire(branchSessionId)).toBeNull();

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe("profile_default");
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");

    const sourceMessages = await service.getSessionMessages(sourceSessionId);
    expect(sourceMessages?.messages).toHaveLength(3);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(ORG_ID, "web", "profile_default");
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        id: "msg_1",
        sessionId: sourceSessionId,
        seq: 0,
        payload: { role: "user", content: "Hello" },
        createdAt: "2026-06-14T10:00:00.000Z",
      },
    ]);

    await expect(service.branchSession(sourceSessionId, 3)).rejects.toThrow(
      "messageIndex is out of bounds.",
    );
  });

  test("falls back to org default when the requested profile is missing", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertOrganization({
        id: ORG_ID,
        name: "Test Org",
        slug: "test-org",
        createdAt: now,
        updatedAt: now,
      });

      await db.upsertProfile({
        id: "profile_custom",
        name: "Custom",
        systemPrompt: "You are helpful.",
        model: null,
        isSuper: false,
        orgId: ORG_ID,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      const sessionId = await service.createSession(ORG_ID, "web", "missing_profile");
      const session = await db.getSession(sessionId);

      expect(session?.profileId).toBe("profile_custom");
    } finally {
      database.close();
    }
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
            id: "compat-1",
            type: "openai_compatible",
            label: "NetraRuntime",
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            customModels: [{ id: "qwen3.6-35b", default: true, supportsThinking: true }],
            createdAt: new Date().toISOString(),
          },
        ],
        thinkingEnabled: true,
        thinkingEffort: "high",
      },
      null,
      db,
    );

    const options = (service as unknown as {
      resolveChatProviderOptions: (
        providerInstance: {
          type: "openai_compatible";
          id: string;
          label: string;
          apiKey: string;
          baseUrl: string;
          createdAt: string;
        },
        thinkingSettings: { enabled: boolean; effort: "low" | "medium" | "high" },
      ) => { thinking?: { enabled: boolean; effort: string } } | undefined;
    }).resolveChatProviderOptions(
      {
        id: "compat-1",
        type: "openai_compatible",
        label: "NetraRuntime",
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        createdAt: new Date().toISOString(),
      },
      { enabled: true, effort: "high" },
    );

    expect(options?.thinking).toEqual({ enabled: true, effort: "high" });
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
            id: "p-openai-1",
            type: "openai",
            label: "OpenAI",
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      null,
      db,
    );

    const saved = await service.setVisionSettings({ model: "p-openai-1::gpt-4o-mini" });

    expect(saved).toEqual({ vision: { model: "p-openai-1::gpt-4o-mini" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      visionModel: "p-openai-1::gpt-4o-mini",
      transcriptionModel: null,
    });
    expect(await service.getVisionSettings()).toEqual({
      vision: { model: "p-openai-1::gpt-4o-mini" },
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
            id: "p-openai-1",
            type: "openai",
            label: "OpenAI",
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      null,
      db,
    );

    const saved = await service.setTranscriptionSettings({ model: "p-openai-1::whisper-1" });

    expect(saved).toEqual({ transcription: { model: "p-openai-1::whisper-1" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: "p-openai-1::whisper-1",
    });
    expect(await service.getTranscriptionSettings()).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
  });
});

describe("AgentService coding delegation context", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(path.join(tmpdir(), "nakama-agent-delegation-bin-"));
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
      await rm(tempBinDir, { recursive: true, force: true });
      tempBinDir = "";
    }
  });

  test("includes harness command template and backend guidance for bash delegation", async () => {
    const db = createInMemoryDatabaseAdapter();
    await installFakeOpenCode(tempBinDir);
    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-opencode",
          kind: "opencode",
          name: "OpenCode",
          command: "opencode",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: null,
      updatedAt: new Date().toISOString(),
    });

    const service = new AgentService(null, null, db);
    const context = await (service as unknown as {
      formatCodingDelegationContext(orgId: string, profileId: string): Promise<string>;
    }).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("bash");
    expect(context).toContain("opencode run");
    expect(context).not.toContain("delegate_coding_task");
    expect(context).not.toContain("workspace settings");
  });

  test("lists install commands when no coding agent CLI is installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [],
      selectedCodingAgentHarness: null,
      updatedAt: new Date().toISOString(),
    });

    const service = new AgentService(null, null, db);
    const context = await (service as unknown as {
      formatCodingDelegationContext(orgId: string, profileId: string): Promise<string>;
    }).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("No coding agent CLI is installed");
    expect(context).toContain("npm install -g");
    expect(context).not.toContain("workspace settings");
    expect(context).not.toContain("delegate_coding_task");
  });

  test("asks the user when multiple coding agent CLIs are installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await installFakeOpenCode(tempBinDir);
    await Bun.write(path.join(tempBinDir, "claude"), "#!/bin/sh\necho claude\n");
    await chmod(path.join(tempBinDir, "claude"), 0o755);

    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-opencode",
          kind: "opencode",
          name: "OpenCode",
          command: "opencode",
          args: [],
          enabled: true,
        },
        {
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
          command: "claude",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: "coding-harness-opencode",
      updatedAt: new Date().toISOString(),
    });

    const service = new AgentService(null, null, db);
    const context = await (service as unknown as {
      formatCodingDelegationContext(orgId: string, profileId: string): Promise<string>;
    }).formatCodingDelegationContext("org_test", "profile_test");

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
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-skill-manage-inject-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }
  });

  test("injects skill_manage for web/cli only when manage-skills is assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();
    const manage = (await skills.listSkills()).skills.find((skill) => skill.name === "manage-skills");
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
        },
      ): Promise<Array<{ name: string }>>;
    };

    const resolve = (service as unknown as ResolveTools).resolveProfileTools.bind(service);
    const profile = createDefaultProfile();

    const webTools = await resolve(profile, { includeSkillManageTools: true });
    expect(webTools.some((tool) => tool.name === "skill_manage")).toBe(true);

    const telegramTools = await resolve(profile, { includeSkillManageTools: false });
    expect(telegramTools.some((tool) => tool.name === "skill_manage")).toBe(false);

    const automationTools = await resolve(profile, {
      includeAutomationTools: false,
    });
    expect(automationTools.some((tool) => tool.name === "skill_manage")).toBe(false);
  });
});

async function installFakeOpenCode(binDir: string): Promise<void> {
  const scriptPath = path.join(binDir, "opencode");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"fake opencode\"",
      "  exit 0",
      "fi",
      "printf '%s' \"$*\"",
    ].join("\n"),
  );
  await chmod(scriptPath, 0o755);
}
